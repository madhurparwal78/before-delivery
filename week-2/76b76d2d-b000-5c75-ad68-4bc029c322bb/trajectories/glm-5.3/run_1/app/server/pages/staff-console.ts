import type { Locale } from '../domain/model';
import { copy, formatAmount } from '../domain/i18n';
import { esc, layout } from './layout';
import type { PageSession } from './public';

export function staffConsolePage(
  locale: Locale,
  path: string,
  session: PageSession,
  role: 'door' | 'programmer' | 'finance',
): string {
  const l = locale;
  const roleLabel = role === 'door' ? copy.staffDoor[l]
    : role === 'programmer' ? copy.staffProgramme[l]
      : copy.staffFinance[l];

  const navLinks = role === 'door'
    ? `<a href="#door-section">${esc(copy.staffDoor[l])}</a>`
    : role === 'programmer'
      ? `<a href="#programme-section">${esc(copy.staffProgramme[l])}</a>`
      : `<a href="#finance-section">${esc(copy.staffFinance[l])}</a>`;

  const doorSection = role !== 'door' ? '' : `
  <section id="door-section" aria-labelledby="door-heading">
    <h2 id="door-heading" class="serif">${esc(copy.staffDoor[l])}</h2>
    <label class="field">${esc(copy.screening[l])}
      <select id="door-screening-select"></select>
    </label>
    <table id="door-list" class="data-table" aria-label="${esc(copy.doorList[l])}">
      <thead><tr><th>${esc(copy.seatCol[l])}</th><th>${esc(copy.initialCol[l])}</th><th>${esc(copy.ticketCol[l])}</th><th>${esc(copy.statusCol[l])}</th></tr></thead>
      <tbody id="door-list-body"></tbody>
    </table>
    <label class="field">${esc(copy.ticketOrBooking[l])} <input type="search" id="door-search"></label>
    <button type="button" id="door-checkin">${esc(copy.checkIn[l])}</button>
    <p id="staff-status" role="status" aria-live="polite" aria-label="${esc(copy.staffStatus[l])}" class="status-line"></p>
    <p id="staff-error" role="alert" aria-label="${esc(copy.staffError[l])}" class="error-line"></p>
  </section>`;

  const programmeSection = role !== 'programmer' ? '' : `
  <section id="programme-section" aria-labelledby="programme-heading">
    <h2 id="programme-heading" class="serif">${esc(copy.staffProgramme[l])}</h2>
    <h3>${l === 'en' ? 'New season' : 'Nouvelle saison'}</h3>
    <label class="field">${esc(copy.seasonSlug[l])} <input type="text" id="season-slug"></label>
    <label class="field">${esc(copy.titleEn[l])} <input type="text" id="season-title-en"></label>
    <label class="field">${esc(copy.titleFr[l])} <input type="text" id="season-title-fr"></label>
    <label class="field">${esc(copy.publicSaleDate[l])} <input type="date" id="season-sale-date"></label>
    <button type="button" id="create-season">${esc(copy.createSeason[l])}</button>
    <h3>${l === 'en' ? 'Add screenings' : 'Ajouter des séances'}</h3>
    <label class="field">${esc(copy.seasonsTable[l])}
      <select id="programme-season-select"></select>
    </label>
    <label class="field">${esc(copy.filmTitle[l])} <input type="text" id="screening-film"></label>
    <label class="field">${esc(copy.format[l])}
      <select id="screening-format">
        <option value="35mm">35mm</option>
        <option value="16mm">16mm</option>
        <option value="DCP">DCP</option>
      </select>
    </label>
    <label class="field">${esc(copy.auditorium[l])}
      <select id="screening-auditorium">
        <option value="MH1">MH1</option>
        <option value="MH2">MH2</option>
        <option value="AC1">AC1</option>
      </select>
    </label>
    <label class="field">${esc(copy.firstShowtime[l])} <input type="datetime-local" id="screening-first"></label>
    <label class="field">${esc(copy.weeklyOccurrences[l])} <input type="number" id="screening-weeks" min="1" max="26" value="1"></label>
    <button type="button" id="add-screenings">${esc(copy.addScreenings[l])}</button>
    <h3>${esc(copy.seasonsTable[l])}</h3>
    <table id="seasons-table" class="data-table" aria-label="${esc(copy.seasonsTable[l])}">
      <thead><tr><th>${l === 'en' ? 'Season' : 'Saison'}</th><th>${l === 'en' ? 'State' : 'État'}</th><th>${l === 'en' ? 'Actions' : 'Actions'}</th></tr></thead>
      <tbody id="seasons-table-body"></tbody>
    </table>
    <div id="withdraw-dialog" role="dialog" aria-modal="true" aria-label="${esc(copy.withdrawSeason[l])}" hidden>
      <label class="field">${esc(copy.reason[l])} <input type="text" id="withdraw-reason"></label>
      <button type="button" id="confirm-withdrawal" class="danger-action">${esc(copy.confirmWithdrawal[l])}</button>
    </div>
    <p id="staff-status" role="status" aria-live="polite" aria-label="${esc(copy.staffStatus[l])}" class="status-line"></p>
    <p id="staff-error" role="alert" aria-label="${esc(copy.staffError[l])}" class="error-line"></p>
  </section>`;

  const financeSection = role !== 'finance' ? '' : `
  <section id="finance-section" aria-labelledby="finance-heading">
    <h2 id="finance-heading" class="serif">${esc(copy.staffFinance[l])}</h2>
    <div class="staff-panes">
      <div class="staff-list-pane">
        <label class="field">${esc(copy.findBooking[l])} <input type="search" id="finance-lookup"></label>
        <button type="button" id="finance-search">${esc(copy.search[l])}</button>
        <div id="finance-result"></div>
        <section aria-label="${esc(copy.reconciliation[l])}" id="reconciliation" role="region">
          <h3>${esc(copy.reconciliation[l])}</h3>
          <label class="field">${esc(copy.businessDay[l])} <input type="date" id="reconciliation-date"></label>
          <button type="button" id="load-day">${esc(copy.loadDay[l])}</button>
          <table id="takings" class="data-table" aria-label="${esc(copy.takings[l])}">
            <tbody id="takings-body"></tbody>
          </table>
          <a id="download-csv" href="#">${esc(copy.downloadCsv[l])}</a>
          <button type="button" id="accept-killbill">${esc(copy.acceptKillBill[l])}</button>
          <div id="accept-dialog" role="dialog" aria-modal="true" aria-label="${esc(copy.acceptKillBill[l])}" hidden>
            <label class="field">${esc(copy.reason[l])} <input type="text" id="accept-reason"></label>
            <button type="button" id="confirm-accept">${esc(copy.confirm[l])}</button>
          </div>
        </section>
        <section aria-label="${esc(copy.enquiries[l])}">
          <h3>${esc(copy.enquiries[l])}</h3>
          <table id="enquiries-table" class="data-table" aria-label="${esc(copy.enquiries[l])}">
            <thead><tr><th>${l === 'en' ? 'Ref' : 'Réf'}</th><th>${esc(copy.subject[l])}</th><th></th></tr></thead>
            <tbody id="enquiries-table-body"></tbody>
          </table>
          <label class="field">${esc(copy.reply[l])} <textarea id="enquiry-reply" rows="4"></textarea></label>
          <button type="button" id="send-reply">${esc(copy.sendReply[l])}</button>
        </section>
      </div>
      <div class="staff-detail-pane">
        <section aria-label="${esc(copy.auditList[l])}">
          <h3>${esc(copy.auditList[l])}</h3>
          <table id="audit-table" class="data-table" aria-label="${esc(copy.auditList[l])}">
            <thead><tr><th>${l === 'en' ? 'At' : 'Le'}</th><th>${l === 'en' ? 'Actor' : 'Acteur'}</th><th>${l === 'en' ? 'Action' : 'Action'}</th><th>${l === 'en' ? 'Target' : 'Cible'}</th><th>${l === 'en' ? 'Amount' : 'Montant'}</th></tr></thead>
            <tbody id="audit-table-body"></tbody>
          </table>
        </section>
        <section aria-label="${esc(copy.mailOutbox[l])}">
          <h3>${esc(copy.mailOutbox[l])}</h3>
          <table id="outbox-table" class="data-table" aria-label="${esc(copy.mailOutbox[l])}">
            <thead><tr><th>${l === 'en' ? 'Key' : 'Clé'}</th><th>${l === 'en' ? 'To' : 'À'}</th><th>${l === 'en' ? 'State' : 'État'}</th></tr></thead>
            <tbody id="outbox-table-body"></tbody>
          </table>
        </section>
      </div>
    </div>
    <p id="staff-status" role="status" aria-live="polite" aria-label="${esc(copy.staffStatus[l])}" class="status-line"></p>
    <p id="staff-error" role="alert" aria-label="${esc(copy.staffError[l])}" class="error-line"></p>
  </section>`;

  const main = `  <nav id="staff-nav" aria-label="${esc(copy.staff[l])}" class="staff-nav">
    ${navLinks}
  </nav>
${doorSection}
${programmeSection}
${financeSection}`;

  return layout({ locale, path, signedIn: session.signedIn, isStaff: true }, {
    title: roleLabel,
    heading: roleLabel,
    mainContent: main,
    bodyClass: `page-staff role-${role}`,
  });
}
