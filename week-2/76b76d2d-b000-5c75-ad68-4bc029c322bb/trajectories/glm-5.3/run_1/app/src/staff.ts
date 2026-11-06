import { api, formatAmount, type Locale, type ErrorShape } from './common';

const locale: Locale = document.documentElement.lang === 'fr' ? 'fr' : 'en';
const L = locale === 'fr';

function showError(err: unknown): void {
  const line = document.getElementById('staff-error');
  const e = err as Error & { payload?: ErrorShape };
  if (line) line.textContent = e.payload?.error?.message ?? e.message;
}

function announce(text: string): void {
  const line = document.getElementById('staff-status');
  if (line) line.textContent = text;
}

interface DoorTicket {
  ticket_code: string;
  seat: string;
  initial: string;
  status: string;
  booking_ref: string;
}

function setupDoor(): void {
  const section = document.getElementById('door-section');
  if (!section) return;
  const select = document.getElementById('door-screening-select') as HTMLSelectElement | null;
  const body = document.getElementById('door-list-body');
  const search = document.getElementById('door-search') as HTMLInputElement | null;
  const checkin = document.getElementById('door-checkin');
  let selectedId = '';

  async function loadScreenings(): Promise<void> {
    if (!select) return;
    const data = await api<{ screenings: { id: string; film_title: string; starts_at: string }[] }>('/api/door/screenings');
    select.innerHTML = data.screenings.map(s =>
      `<option value="${s.id}">${s.film_title} — ${s.starts_at}</option>`).join('');
    if (data.screenings[0]) {
      selectedId = data.screenings[0].id;
      await loadList();
    }
  }

  async function loadList(): Promise<void> {
    if (!body || !selectedId) return;
    const data = await api<{ tickets: DoorTicket[] }>(`/api/door/screenings/${selectedId}/list`);
    body.innerHTML = data.tickets.map(t =>
      `<tr><td class="mono">${t.seat}</td><td>${t.initial}</td><td class="mono">${t.ticket_code}</td><td>${t.status}</td></tr>`).join('');
  }

  select?.addEventListener('change', () => {
    selectedId = select.value;
    void loadList();
  });

  async function doCheckIn(): Promise<void> {
    if (!search || !checkin) return;
    const code = search.value.trim().toUpperCase();
    if (!code) return;
    checkin.setAttribute('disabled', 'disabled');
    try {
      if (code.startsWith('T-')) {
        const data = await api<{ ticket: DoorTicket }>(`/api/door/tickets/${encodeURIComponent(code)}/check-in`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        announce(L
          ? `Entrée enregistrée : place ${data.ticket.seat}.`
          : `Checked in: seat ${data.ticket.seat}.`);
      } else if (code.startsWith('HB-')) {
        const data = await api<{ checked_in: number; already_checked_in: number }>(`/api/door/bookings/${encodeURIComponent(code)}/check-in`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        announce(L
          ? `${data.checked_in} billets sur ${data.checked_in + data.already_checked_in} enregistrés.`
          : `Checked in ${data.checked_in} of ${data.checked_in + data.already_checked_in} tickets.`);
      }
      search.value = '';
      await loadList();
    } catch (err) {
      showError(err);
    } finally {
      checkin.removeAttribute('disabled');
      search.focus();
    }
  }

  checkin?.addEventListener('click', () => void doCheckIn());
  search?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void doCheckIn();
    }
  });

  setInterval(() => void loadList(), 10000);
  void loadScreenings();
}

function setupProgramme(): void {
  const section = document.getElementById('programme-section');
  if (!section) return;
  const seasonSelect = document.getElementById('programme-season-select') as HTMLSelectElement | null;
  const seasonsBody = document.getElementById('seasons-table-body');

  async function loadSeasons(): Promise<void> {
    const data = await api<{ seasons: { slug: string; state: string; title: string }[] }>('/api/programmer/seasons');
    if (seasonSelect) {
      seasonSelect.innerHTML = data.seasons.map(s => `<option value="${s.slug}">${s.slug}</option>`).join('');
    }
    if (seasonsBody) {
      seasonsBody.innerHTML = data.seasons.map(s => `
        <tr data-slug="${s.slug}">
          <td class="mono">${s.slug}</td>
          <td>${s.state}</td>
          <td>
            <button type="button" class="season-transition" data-to="scheduled">${L ? 'Planifier la saison' : 'Schedule season'}</button>
            <button type="button" class="season-transition" data-to="archived">${L ? 'Archiver la saison' : 'Archive season'}</button>
            <button type="button" class="season-transition withdraw" data-to="withdrawn">${L ? 'Retirer la saison' : 'Withdraw season'}</button>
          </td>
        </tr>`).join('');
      for (const button of Array.from(seasonsBody.querySelectorAll<HTMLButtonElement>('.season-transition'))) {
        button.addEventListener('click', async () => {
          const slug = button.closest('tr')?.dataset.slug ?? '';
          const to = button.dataset.to ?? '';
          if (to === 'withdrawn') {
            const dialog = document.getElementById('withdraw-dialog') as HTMLElement | null;
            if (!dialog) return;
            dialog.hidden = false;
            (dialog.dataset.slug = slug);
            document.getElementById('confirm-withdrawal')?.focus();
            return;
          }
          button.setAttribute('disabled', 'disabled');
          announce(L ? 'En cours…' : 'Working…');
          try {
            await api(`/api/programmer/seasons/${slug}/transition`, {
              method: 'POST',
              body: JSON.stringify({ to }),
            });
            announce(to === 'scheduled' ? (L ? 'Saison planifiée.' : 'Season scheduled.') : (L ? 'Saison archivée.' : 'Season archived.'));
            await loadSeasons();
          } catch (err) {
            showError(err);
            button.removeAttribute('disabled');
          }
        });
      }
    }
  }

  document.getElementById('confirm-withdrawal')?.addEventListener('click', async () => {
    const dialog = document.getElementById('withdraw-dialog') as HTMLElement | null;
    if (!dialog) return;
    const slug = dialog.dataset.slug ?? '';
    const reason = (document.getElementById('withdraw-reason') as HTMLInputElement | null)?.value.trim() ?? '';
    try {
      const data = await api<{ refunded_bookings: number }>(`/api/programmer/seasons/${slug}/transition`, {
        method: 'POST',
        body: JSON.stringify({ to: 'withdrawn', reason }),
      });
      announce(L
        ? `Saison retirée. ${data.refunded_bookings} réservations remboursées.`
        : `Season withdrawn. ${data.refunded_bookings} bookings refunded.`);
      dialog.hidden = true;
      await loadSeasons();
    } catch (err) {
      showError(err);
    }
  });

  document.getElementById('create-season')?.addEventListener('click', async () => {
    const button = document.getElementById('create-season') as HTMLButtonElement | null;
    if (!button) return;
    button.setAttribute('disabled', 'disabled');
    announce(L ? 'En cours…' : 'Working…');
    try {
      await api('/api/programmer/seasons', {
        method: 'POST',
        body: JSON.stringify({
          slug: (document.getElementById('season-slug') as HTMLInputElement).value.trim(),
          title_en: (document.getElementById('season-title-en') as HTMLInputElement).value.trim(),
          title_fr: (document.getElementById('season-title-fr') as HTMLInputElement).value.trim(),
          public_sale_date: (document.getElementById('season-sale-date') as HTMLInputElement).value,
        }),
      });
      announce(L ? 'Saison créée.' : 'Season created.');
      await loadSeasons();
    } catch (err) {
      showError(err);
    } finally {
      button.removeAttribute('disabled');
    }
  });

  document.getElementById('add-screenings')?.addEventListener('click', async () => {
    const button = document.getElementById('add-screenings') as HTMLButtonElement | null;
    if (!button) return;
    button.setAttribute('disabled', 'disabled');
    announce(L ? 'En cours…' : 'Working…');
    const slug = seasonSelect?.value ?? '';
    try {
      const data = await api<{ screenings: unknown[] }>(`/api/programmer/seasons/${slug}/screenings`, {
        method: 'POST',
        body: JSON.stringify({
          film_title: (document.getElementById('screening-film') as HTMLInputElement).value.trim(),
          format: (document.getElementById('screening-format') as HTMLSelectElement).value,
          auditorium: (document.getElementById('screening-auditorium') as HTMLSelectElement).value,
          first_local: (document.getElementById('screening-first') as HTMLInputElement).value,
          weeks: Number((document.getElementById('screening-weeks') as HTMLInputElement).value),
        }),
      });
      announce(L
        ? `${data.screenings.length} séances ajoutées.`
        : `${data.screenings.length} screenings added.`);
    } catch (err) {
      showError(err);
    } finally {
      button.removeAttribute('disabled');
    }
  });

  void loadSeasons();
}

function setupFinance(): void {
  const section = document.getElementById('finance-section');
  if (!section) return;
  const result = document.getElementById('finance-result');
  const takingsBody = document.getElementById('takings-body');

  async function lookup(query: string): Promise<void> {
    if (!result) return;
    if (!query) return;
    try {
      const data = await api<Record<string, unknown>>(`/api/finance/lookup?q=${encodeURIComponent(query)}`);
      renderLookup(data);
    } catch (err) {
      showError(err);
      result.innerHTML = `<p>${L
        ? `Aucune réservation, aucun billet, aucun cadeau ni aucun compte ne correspond à « ${query} ».`
        : `No booking, ticket, gift or account matches “${query}”.`}</p>`;
    }
  }

  function renderLookup(data: Record<string, unknown>): void {
    if (!result) return;
    const kind = data.kind as string;
    if (kind === 'booking') {
      const booking = data.booking as Record<string, unknown>;
      const patron = data.patron as { name: string; email: string; phone: string | null; account_number: string | null };
      result.innerHTML = `
        <section role="region" aria-label="${L ? `Réservation ${booking.ref}` : `Booking ${booking.ref}`}" id="booking-region">
          <h3 class="mono">${booking.ref}</h3>
          <p>${patron.name} — ${patron.email}</p>
          <table class="data-table"><tbody>
            <tr><th>${L ? 'Entrée' : 'Admission'}</th><td class="mono">${formatAmount(booking.admission_cents as number, locale)}</td></tr>
            <tr><th>${L ? 'TPS (5 %)' : 'GST (5%)'}</th><td class="mono">${formatAmount(booking.gst_cents as number, locale)}</td></tr>
            <tr><th>${L ? 'TVQ (9,975 %)' : 'QST (9.975%)'}</th><td class="mono">${formatAmount(booking.qst_cents as number, locale)}</td></tr>
            <tr><th>${L ? 'Total' : 'Total'}</th><td class="mono">${formatAmount(booking.total_cents as number, locale)}</td></tr>
            <tr><th>${L ? 'État' : 'State'}</th><td>${booking.state}</td></tr>
          </tbody></table>
          ${booking.state === 'paid' ? `
          <button type="button" id="finance-refund">${L ? 'Rembourser la réservation' : 'Refund booking'}</button>
          <div id="finance-refund-dialog" role="dialog" aria-modal="true" aria-label="${L ? 'Rembourser la réservation' : 'Refund booking'}" hidden>
            <label>${L ? 'Motif' : 'Reason'} <input type="text" id="finance-refund-reason"></label>
            <button type="button" id="finance-confirm-refund">${L ? 'Confirmer le remboursement' : 'Confirm refund'}</button>
          </div>` : ''}
          ${patron.account_number ? `
          <button type="button" id="finance-goodwill">${L ? 'Émettre un crédit de courtoisie' : 'Issue goodwill credit'}</button>
          <div id="finance-goodwill-dialog" role="dialog" aria-modal="true" aria-label="${L ? 'Émettre un crédit de courtoisie' : 'Issue goodwill credit'}" hidden>
            <label>${L ? 'Montant en dollars' : 'Amount in dollars'} <input type="text" id="goodwill-amount"></label>
            <label>${L ? 'Motif' : 'Reason'} <input type="text" id="goodwill-reason"></label>
            <button type="button" id="finance-issue-credit">${L ? 'Émettre le crédit' : 'Issue credit'}</button>
          </div>` : ''}
        </section>`;
      const refundButton = document.getElementById('finance-refund');
      refundButton?.addEventListener('click', () => {
        const dialog = document.getElementById('finance-refund-dialog') as HTMLElement | null;
        if (dialog) {
          dialog.hidden = false;
          document.getElementById('finance-refund-reason')?.focus();
        }
      });
      document.getElementById('finance-confirm-refund')?.addEventListener('click', async () => {
        const reason = (document.getElementById('finance-refund-reason') as HTMLInputElement | null)?.value.trim() ?? '';
        try {
          const data = await api<{ refund: { refunded_cents: number; recredited_cents: number } }>(
            `/api/finance/bookings/${booking.ref}/refund`,
            { method: 'POST', body: JSON.stringify({ reason }) },
          );
          announce(L
            ? `Remboursement émis : ${formatAmount(data.refund.refunded_cents, locale)} sur le paiement d'origine.${data.refund.recredited_cents > 0 ? ` ${formatAmount(data.refund.recredited_cents, locale)} remis en crédit.` : ''}`
            : `Refund issued: ${formatAmount(data.refund.refunded_cents, locale)} to the original payment.${data.refund.recredited_cents > 0 ? ` ${formatAmount(data.refund.recredited_cents, locale)} returned to your credit.` : ''}`);
          const dialog = document.getElementById('finance-refund-dialog');
          if (dialog) dialog.hidden = true;
          await refreshAudit();
        } catch (err) {
          showError(err);
        }
      });
      const goodwillButton = document.getElementById('finance-goodwill');
      goodwillButton?.addEventListener('click', () => {
        const dialog = document.getElementById('finance-goodwill-dialog') as HTMLElement | null;
        if (dialog) {
          dialog.hidden = false;
          document.getElementById('goodwill-amount')?.focus();
        }
      });
      document.getElementById('finance-issue-credit')?.addEventListener('click', async () => {
        const accountNumber = patron.account_number as string;
        const amountDollars = (document.getElementById('goodwill-amount') as HTMLInputElement | null)?.value.trim() ?? '';
        const reason = (document.getElementById('goodwill-reason') as HTMLInputElement | null)?.value.trim() ?? '';
        const cents = Math.round(Number(amountDollars.replace(',', '.')) * 100);
        try {
          const data = await api<{ credit: { balance_cents: number } }>('/api/finance/credits', {
            method: 'POST',
            body: JSON.stringify({ account_number: accountNumber, amount_cents: cents, reason }),
          });
          announce(L
            ? `Crédit de courtoisie de ${formatAmount(cents, locale)} émis au compte ${accountNumber}.`
            : `Goodwill credit of ${formatAmount(cents, locale)} issued to ${accountNumber}.`);
          void data;
          const dialog = document.getElementById('finance-goodwill-dialog');
          if (dialog) dialog.hidden = true;
          await refreshAudit();
        } catch (err) {
          showError(err);
        }
      });
    } else if (kind === 'account') {
      const account = data.account as Record<string, unknown>;
      const ledger = (data.ledger as { id: number; kind: string; amount_cents: number; reference: string; at: string }[]) ?? [];
      result.innerHTML = `
        <section role="region" aria-label="${L ? `Compte ${account.number}` : `Account ${account.number}`}" id="account-region">
          <h3 class="mono">${account.number}</h3>
          <p>${account.name} — ${account.email}</p>
          <table class="data-table"><tbody>
            <tr><th>${L ? 'Solde de crédit' : 'Credit balance'}</th><td class="mono">${formatAmount(account.credit_balance_cents as number, locale)}</td></tr>
          </tbody></table>
          <button type="button" id="finance-goodwill">${L ? 'Émettre un crédit de courtoisie' : 'Issue goodwill credit'}</button>
          <div id="finance-goodwill-dialog" role="dialog" aria-modal="true" aria-label="${L ? 'Émettre un crédit de courtoisie' : 'Issue goodwill credit'}" hidden>
            <label>${L ? 'Montant en dollars' : 'Amount in dollars'} <input type="text" id="goodwill-amount"></label>
            <label>${L ? 'Motif' : 'Reason'} <input type="text" id="goodwill-reason"></label>
            <button type="button" id="finance-issue-credit">${L ? 'Émettre le crédit' : 'Issue credit'}</button>
          </div>
          <table class="data-table" aria-label="${L ? 'Mouvements de crédit' : 'Credit movements'}">
            <thead><tr><th>${L ? 'Référence' : 'Reference'}</th><th>${L ? 'Type' : 'Kind'}</th><th>${L ? 'Montant' : 'Amount'}</th></tr></thead>
            <tbody>${ledger.map(m => `<tr><td class="mono">${m.reference}</td><td>${m.kind}</td><td class="mono">${formatAmount(m.amount_cents, locale)}</td></tr>`).join('')}</tbody>
          </table>
        </section>`;
      const goodwillButton = document.getElementById('finance-goodwill');
      goodwillButton?.addEventListener('click', () => {
        const dialog = document.getElementById('finance-goodwill-dialog') as HTMLElement | null;
        if (dialog) {
          dialog.hidden = false;
          document.getElementById('goodwill-amount')?.focus();
        }
      });
      document.getElementById('finance-issue-credit')?.addEventListener('click', async () => {
        const amountDollars = (document.getElementById('goodwill-amount') as HTMLInputElement | null)?.value.trim() ?? '';
        const reason = (document.getElementById('goodwill-reason') as HTMLInputElement | null)?.value.trim() ?? '';
        const cents = Math.round(Number(amountDollars.replace(',', '.')) * 100);
        try {
          await api('/api/finance/credits', {
            method: 'POST',
            body: JSON.stringify({ account_number: account.number, amount_cents: cents, reason }),
          });
          announce(L
            ? `Crédit de courtoisie de ${formatAmount(cents, locale)} émis au compte ${account.number}.`
            : `Goodwill credit of ${formatAmount(cents, locale)} issued to ${account.number}.`);
          const dialog = document.getElementById('finance-goodwill-dialog');
          if (dialog) dialog.hidden = true;
          await refreshAudit();
        } catch (err) {
          showError(err);
        }
      });
    } else if (kind === 'gift') {
      const gift = data.gift as Record<string, unknown>;
      result.innerHTML = `
        <section role="region" aria-label="${L ? `Cadeau ${gift.ref}` : `Gift ${gift.ref}`}" id="gift-region">
          <h3 class="mono">${gift.ref}</h3>
          <p>${gift.recipient_name} — ${gift.state}</p>
        </section>`;
    }
    const heading = result.querySelector('h3');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus();
  }

  const searchButton = document.getElementById('finance-search');
  const searchInput = document.getElementById('finance-lookup') as HTMLInputElement | null;
  searchButton?.addEventListener('click', () => void lookup(searchInput?.value.trim() ?? ''));
  searchInput?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void lookup(searchInput.value.trim());
    }
  });

  async function loadDay(): Promise<void> {
    const dateInput = document.getElementById('reconciliation-date') as HTMLInputElement | null;
    const date = dateInput?.value ?? '';
    if (!date || !takingsBody) return;
    try {
      const data = await api<{
        status: string;
        local: Record<string, number>;
        killbill: Record<string, number>;
        difference_cents: number;
      }>(`/api/finance/reconciliation?date=${date}`);
      const rows: [string, number][] = [
        [L ? 'Entrée' : 'Admission', data.local.admission_cents],
        [L ? 'TPS (5 %)' : 'GST (5%)', data.local.gst_cents],
        [L ? 'TVQ (9,975 %)' : 'QST (9.975%)', data.local.qst_cents],
        [L ? 'Contribution' : 'Uplift', data.local.uplift_cents],
        [L ? 'Cadeaux' : 'Gifts', data.local.gift_cents],
        [L ? 'Adhésions' : 'Membership', data.local.membership_cents],
        [L ? 'Crédit dépensé' : 'Credit spent', data.local.credit_spent_cents],
        [L ? 'Remboursements' : 'Refunds', data.local.refunds_cents],
        [L ? 'Recettes locales' : 'Local net', data.local.net_payments_cents],
        [L ? 'Kill Bill' : 'Kill Bill', data.killbill.net_payments_cents],
        [L ? 'Écart' : 'Difference', data.difference_cents],
      ];
      const statusLabel = data.status === 'matched' ? (L ? 'Concordant' : 'Matched')
        : data.status === 'accepted' ? (L ? 'Accepté' : 'Accepted') : (L ? 'Écart' : 'Mismatch');
      takingsBody.innerHTML = rows.map(([label, cents]) =>
        `<tr><th scope="row">${label}</th><td class="mono">${formatAmount(cents, locale)}</td></tr>`).join('')
        + `<tr><th scope="row">${L ? 'Statut' : 'Status'}</th><td>${statusLabel}</td></tr>`;
      const csv = document.getElementById('download-csv');
      if (csv) csv.setAttribute('href', `/api/finance/reconciliation.csv?date=${date}`);
      const accept = document.getElementById('accept-killbill');
      if (accept) {
        accept.hidden = data.status === 'matched';
      }
    } catch (err) {
      showError(err);
    }
  }

  document.getElementById('load-day')?.addEventListener('click', () => void loadDay());

  document.getElementById('accept-killbill')?.addEventListener('click', () => {
    const dialog = document.getElementById('accept-dialog') as HTMLElement | null;
    if (dialog) {
      dialog.hidden = false;
      document.getElementById('accept-reason')?.focus();
    }
  });
  document.getElementById('confirm-accept')?.addEventListener('click', async () => {
    const date = (document.getElementById('reconciliation-date') as HTMLInputElement | null)?.value ?? '';
    const reason = (document.getElementById('accept-reason') as HTMLInputElement | null)?.value.trim() ?? '';
    try {
      const data = await api<{ difference_cents: number }>('/api/finance/reconciliation/accept', {
        method: 'POST',
        body: JSON.stringify({ date, reason }),
      });
      announce(L
        ? `Total de Kill Bill accepté pour le ${date}. L'écart de ${formatAmount(data.difference_cents, locale)} est consigné au journal d'audit.`
        : `Kill Bill total accepted for ${date}. The difference of ${formatAmount(data.difference_cents, locale)} is recorded in the audit list.`);
      const dialog = document.getElementById('accept-dialog');
      if (dialog) dialog.hidden = true;
      await loadDay();
      await refreshAudit();
    } catch (err) {
      showError(err);
    }
  });

  async function refreshAudit(): Promise<void> {
    const body = document.getElementById('audit-table-body');
    if (!body) return;
    try {
      const data = await api<{ entries: { id: number; at: string; actor: string; action: string; target: string; amount_cents: number | null; reason: string }[] }>('/api/finance/audit');
      body.innerHTML = data.entries.map(e => `
        <tr>
          <td class="mono">${e.at}</td>
          <td>${e.actor}</td>
          <td>${e.action}</td>
          <td class="mono">${e.target}</td>
          <td class="mono">${e.amount_cents === null ? '—' : formatAmount(e.amount_cents, locale)}</td>
        </tr>`).join('');
    } catch {
      // keep the last rendering
    }
  }

  async function refreshOutbox(): Promise<void> {
    const body = document.getElementById('outbox-table-body');
    if (!body) return;
    try {
      const data = await api<{ messages: { seq: number; key: string; to: string; state: string }[] }>('/api/finance/outbox');
      const stateLabel = (state: string) => state === 'sent' ? (L ? 'Envoyé' : 'Sent')
        : state === 'dead' ? (L ? 'Non livré' : 'Not delivered') : (L ? 'En attente' : 'Pending');
      body.innerHTML = data.messages.map(m => `
        <tr>
          <td class="mono">${m.key}</td>
          <td>${m.to}</td>
          <td>${stateLabel(m.state)}</td>
        </tr>`).join('');
    } catch {
      // keep the last rendering
    }
  }

  async function refreshEnquiries(): Promise<void> {
    const body = document.getElementById('enquiries-table-body');
    if (!body) return;
    try {
      const data = await api<{ enquiries: { ref: string; subject: string; state: string }[] }>('/api/finance/enquiries');
      body.innerHTML = data.enquiries.map(e => `
        <tr data-ref="${e.ref}">
          <td class="mono">${e.ref}</td>
          <td>${e.subject}</td>
          <td><button type="button" class="open-enquiry">${L ? `Ouvrir ${e.ref}` : `Open ${e.ref}`}</button></td>
        </tr>`).join('');
      for (const button of Array.from(body.querySelectorAll<HTMLButtonElement>('.open-enquiry'))) {
        button.addEventListener('click', () => {
          const ref = button.closest('tr')?.dataset.ref ?? '';
          selectedEnquiry = ref;
          announce(ref);
        });
      }
    } catch {
      // keep the last rendering
    }
  }

  let selectedEnquiry = '';
  document.getElementById('send-reply')?.addEventListener('click', async () => {
    if (!selectedEnquiry) return;
    const body = (document.getElementById('enquiry-reply') as HTMLTextAreaElement | null)?.value.trim() ?? '';
    try {
      const data = await api<{ reply: { enquiry_ref: string } }>(`/api/finance/enquiries/${selectedEnquiry}/reply`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      announce(L
        ? `Réponse enregistrée. Elle sera envoyée à ${data.reply.enquiry_ref}.`
        : `Reply recorded for ${data.reply.enquiry_ref}.`);
      await refreshEnquiries();
      await refreshAudit();
    } catch (err) {
      showError(err);
    }
  });

  setInterval(() => {
    void refreshOutbox();
  }, 10000);
  void refreshAudit();
  void refreshOutbox();
  void refreshEnquiries();
}

setupDoor();
setupProgramme();
setupFinance();
export {};
