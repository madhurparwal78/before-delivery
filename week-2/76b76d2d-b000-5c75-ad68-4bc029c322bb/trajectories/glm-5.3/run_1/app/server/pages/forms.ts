import type { Locale, Tier, Cadence } from '../domain/model';
import { tierPrices } from '../domain/model';
import { copy, formatAmount, tierLabel, cadenceLabel } from '../domain/i18n';
import { esc, layout } from './layout';
import { notFoundPage, type PageSession } from './public';

export function accountPage(locale: Locale, path: string, session: PageSession, data: {
  membership: Record<string, unknown> | null;
  creditBalanceCents: number;
  movements: { id: number; kind: string; amount_cents: number; reference: string; at: string }[];
  bookings: { ref: string; state: string }[];
}): string {
  const l = locale;
  const membership = data.membership;
  const movementRows = data.movements.map(m =>
    `        <tr><td class="mono">${esc(m.reference)}</td><td>${esc(m.kind)}</td><td class="mono">${formatAmount(m.amount_cents, l)}</td><td class="mono">${esc(m.at)}</td></tr>`).join('\n');
  const bookingRows = data.bookings.map(b =>
    `        <tr><td><a href="/${l}/account/bookings/${esc(b.ref)}" class="mono">${esc(b.ref)}</a></td><td>${esc(b.state)}</td></tr>`).join('\n');
  const membershipBlock = membership
    ? `<p>${esc(tierLabel(membership.tier as Tier, l))} · ${esc(cadenceLabel(membership.cadence as Cadence | 'gift', l))}</p>`
    : `<p>${l === 'en' ? 'No active membership.' : 'Aucune adhésion active.'} <a href="/${l}/membership">${esc(copy.navMembership[l])}</a></p>`;
  const main = `  <section aria-label="${esc(copy.membership[l])}" class="account-section" role="region">
    <h2 class="serif">${esc(copy.membership[l])}</h2>
    ${membershipBlock}
  </section>
  <section aria-label="${esc(copy.credit[l])}" class="account-section" role="region">
    <h2 class="serif">${esc(copy.credit[l])}</h2>
    <p id="credit-balance" class="mono">${esc(copy.creditBalance[l])} ${formatAmount(data.creditBalanceCents, l)}</p>
    <table id="credit-movements" class="data-table" aria-label="${esc(copy.creditMovements[l])}">
      <thead><tr><th>${l === 'en' ? 'Reference' : 'Référence'}</th><th>${l === 'en' ? 'Kind' : 'Type'}</th><th>${l === 'en' ? 'Amount' : 'Montant'}</th><th>${l === 'en' ? 'At' : 'Le'}</th></tr></thead>
      <tbody>
${movementRows || `        <tr><td colspan="4">—</td></tr>`}
      </tbody>
    </table>
  </section>
  <section aria-label="${esc(copy.myBookings[l])}" class="account-section">
    <h2 class="serif">${esc(copy.myBookings[l])}</h2>
    <table id="my-bookings" class="data-table" aria-label="${esc(copy.myBookings[l])}">
      <thead><tr><th>${l === 'en' ? 'Reference' : 'Référence'}</th><th>${l === 'en' ? 'Status' : 'Statut'}</th></tr></thead>
      <tbody>
${bookingRows || `        <tr><td colspan="2">—</td></tr>`}
      </tbody>
    </table>
  </section>`;
  return layout({ locale, path, signedIn: session.signedIn, isStaff: false }, {
    title: copy.navMyAccount[l],
    heading: copy.navMyAccount[l],
    mainContent: main,
    bodyClass: 'page-account',
  });
}

export function membershipPage(locale: Locale, path: string, session: PageSession, data: {
  membership: Record<string, unknown> | null;
  creditBalanceCents: number;
}): string {
  const l = locale;
  const tiers: Tier[] = ['friend', 'cinephile', 'projectionist'];
  const radios = tiers.map(t =>
    `        <label><input type="radio" name="tier" value="${t}" aria-label="${esc(tierLabel(t, l))}"> ${esc(tierLabel(t, l))} <span class="mono">${formatAmount(tierPrices[t].annual, l)} / ${l === 'en' ? 'year' : 'an'}</span></label>`).join('\n');
  const currentTier = data.membership?.tier as Tier | undefined;
  const currentCadence = data.membership?.cadence as Cadence | undefined;
  const main = `  <div id="membership-page" data-current-tier="${esc(currentTier ?? '')}" data-current-cadence="${esc(currentCadence ?? '')}" data-credit-balance="${data.creditBalanceCents}">
    <div role="radiogroup" aria-label="${esc(copy.tier[l])}" id="tier-group" class="tier-cards">
${radios}
    </div>
    <button type="button" id="cadence-button" aria-haspopup="listbox" aria-expanded="false">${esc(copy.billing[l])}: ${esc(cadenceLabel(currentCadence ?? 'monthly', l))}</button>
    <div id="cadence-listbox" role="listbox" aria-label="${esc(copy.billingCadence[l])}" hidden>
      <div role="option" aria-selected="false" data-value="annual">${esc(cadenceLabel('annual', l))}</div>
      <div role="option" aria-selected="false" data-value="monthly">${esc(cadenceLabel('monthly', l))}</div>
    </div>
    <p id="membership-preview" class="mono">${l === 'en' ? 'Amount' : 'Montant'}: <span id="membership-amount">${formatAmount(0, l)}</span></p>
    <p id="membership-summary">${data.membership
      ? `${esc(tierLabel(currentTier as Tier, l))} · ${esc(cadenceLabel(currentCadence as Cadence, l))}`
      : (l === 'en' ? 'No active membership.' : 'Aucune adhésion active.')}</p>
    <button type="button" id="membership-action" class="primary-action" ${data.membership ? '' : 'disabled'}>
      ${data.membership ? esc(copy.changeTier[l]) : `${esc(copy.joinFor[l])} ${formatAmount(0, l)}`}
    </button>
    <button type="button" id="verify-code" hidden>${esc(copy.verifyCode[l])}</button>
    <div id="stepup-dialog" role="dialog" aria-modal="true" aria-label="${esc(copy.confirmYou[l])}" hidden>
      <label>${esc(copy.verificationCode[l])} <input type="text" inputmode="numeric" id="stepup-code" maxlength="6"></label>
      <button type="button" id="stepup-verify">${esc(copy.verify[l])}</button>
      <button type="button" id="stepup-resend">${esc(copy.sendNewCode[l])}</button>
      <button type="button" id="stepup-close">${esc(copy.close[l])}</button>
    </div>
    <p id="form-status" role="status" aria-live="polite" aria-label="${esc(copy.formStatus[l])}" class="status-line"></p>
    <p id="form-error" role="alert" aria-label="${esc(copy.formError[l])}" class="error-line"></p>
  </div>`;
  return layout({ locale, path, signedIn: session.signedIn, isStaff: false }, {
    title: copy.navMembership[l],
    heading: copy.navMembership[l],
    mainContent: main,
    bodyClass: 'page-membership',
  });
}

export function giftPage(locale: Locale, path: string, session: PageSession): string {
  const l = locale;
  const tiers: Tier[] = ['friend', 'cinephile', 'projectionist'];
  const radios = tiers.map(t =>
    `        <label><input type="radio" name="tier" value="${t}" aria-label="${esc(tierLabel(t, l))}"> ${esc(tierLabel(t, l))} <span class="mono">${formatAmount(tierPrices[t].annual, l)}</span></label>`).join('\n');
  const main = `  <div id="gift-page">
    <div role="radiogroup" aria-label="${esc(copy.tier[l])}" id="gift-tier-group" class="tier-cards">
${radios}
    </div>
    ${session.signedIn ? '' : `
    <label>${esc(copy.yourName[l])} <input type="text" id="purchaser-name"></label>
    <label>${esc(copy.yourEmail[l])} <input type="email" id="purchaser-email"></label>`}
    <label>${esc(copy.recipientName[l])} <input type="text" id="recipient-name"></label>
    <label>${esc(copy.recipientEmail[l])} <input type="email" id="recipient-email"></label>
    <label>${esc(copy.recipientLanguage[l])}
      <select id="recipient-locale">
        <option value="en">English</option>
        <option value="fr">Français</option>
      </select>
    </label>
    <label>${esc(copy.messageOptional[l])} <input type="text" id="gift-message" maxlength="300"></label>
    <label>${esc(copy.cardholderName[l])} <input type="text" id="gift-cardholder"></label>
    <button type="button" id="buy-gift" class="primary-action" disabled>${esc(copy.buyGiftFor[l])} ${formatAmount(0, l)}</button>
    <button type="button" id="verify-code" hidden>${esc(copy.verifyCode[l])}</button>
    <div id="stepup-dialog" role="dialog" aria-modal="true" aria-label="${esc(copy.confirmYou[l])}" hidden>
      <label>${esc(copy.verificationCode[l])} <input type="text" inputmode="numeric" id="stepup-code" maxlength="6"></label>
      <button type="button" id="stepup-verify">${esc(copy.verify[l])}</button>
      <button type="button" id="stepup-resend">${esc(copy.sendNewCode[l])}</button>
      <button type="button" id="stepup-close">${esc(copy.close[l])}</button>
    </div>
    <p id="form-status" role="status" aria-live="polite" aria-label="${esc(copy.formStatus[l])}" class="status-line"></p>
    <p id="form-error" role="alert" aria-label="${esc(copy.formError[l])}" class="error-line"></p>
  </div>`;
  return layout({ locale, path, signedIn: session.signedIn, isStaff: false }, {
    title: copy.navGift[l],
    heading: copy.navGift[l],
    mainContent: main,
    bodyClass: 'page-gift',
  });
}

export function giftRedemptionPage(locale: Locale, path: string, session: PageSession, gift: {
  tier: Tier; fromName: string; message: string;
} | null): string {
  const l = locale;
  if (!gift) {
    return notFoundPage(locale, path, session);
  }
  const main = `  <div id="gift-redemption" data-tier="${esc(gift.tier)}">
    <p>${esc(tierLabel(gift.tier, l))}${gift.message ? ` — ${esc(gift.message)}` : ''}</p>
    <button type="button" id="redeem-membership" class="primary-action">${esc(copy.redeem[l])}</button>
    <p id="form-status" role="status" aria-live="polite" aria-label="${esc(copy.formStatus[l])}" class="status-line"></p>
    <p id="form-error" role="alert" aria-label="${esc(copy.formError[l])}" class="error-line"></p>
  </div>`;
  return layout({ locale, path, signedIn: session.signedIn, isStaff: false }, {
    title: copy.redeemHeading[l],
    heading: copy.redeemHeading[l],
    mainContent: main,
    bodyClass: 'page-gift-redemption',
  });
}

export function signInPage(locale: Locale, path: string, session: PageSession): string {
  const l = locale;
  const main = `  <div id="signin-page" class="auth-form">
    <label>${esc(copy.email[l])} <input type="email" id="signin-email"></label>
    <label>${esc(copy.password[l])} <input type="password" id="signin-password"></label>
    <button type="button" id="signin-submit" class="primary-action">${esc(copy.signIn[l])}</button>
    <a href="/${l}/signup">${esc(copy.createAnAccount[l])}</a>
    <p id="form-status" role="status" aria-live="polite" aria-label="${esc(copy.formStatus[l])}" class="status-line"></p>
    <p id="form-error" role="alert" aria-label="${esc(copy.formError[l])}" class="error-line"></p>
  </div>`;
  return layout({ locale, path, signedIn: session.signedIn, isStaff: false }, {
    title: copy.signIn[l],
    heading: copy.signIn[l],
    mainContent: main,
    bodyClass: 'page-signin',
  });
}

export function signUpPage(locale: Locale, path: string, session: PageSession): string {
  const l = locale;
  const main = `  <div id="signup-page" class="auth-form">
    <label>${esc(copy.fullName[l])} <input type="text" id="signup-name"></label>
    <label>${esc(copy.email[l])} <input type="email" id="signup-email"></label>
    <label>${esc(copy.password[l])} <input type="password" id="signup-password"></label>
    <label>${esc(copy.preferredLanguage[l])}
      <select id="signup-locale">
        <option value="en">English</option>
        <option value="fr">Français</option>
      </select>
    </label>
    <button type="button" id="signup-submit" class="primary-action">${esc(copy.createAccount[l])}</button>
    <p id="form-status" role="status" aria-live="polite" aria-label="${esc(copy.formStatus[l])}" class="status-line"></p>
    <p id="form-error" role="alert" aria-label="${esc(copy.formError[l])}" class="error-line"></p>
  </div>`;
  return layout({ locale, path, signedIn: session.signedIn, isStaff: false }, {
    title: copy.signUp[l],
    heading: copy.signUp[l],
    mainContent: main,
    bodyClass: 'page-signup',
  });
}

export function bookingLinkPage(locale: Locale, path: string, session: PageSession): string {
  const l = locale;
  const main = `  <div id="booking-link-page" class="auth-form">
    <label>${esc(copy.bookingReference[l])} <input type="text" id="link-ref"></label>
    <label>${esc(copy.email[l])} <input type="email" id="link-email"></label>
    <button type="button" id="link-submit" class="primary-action">${esc(copy.emailMeNewLink[l])}</button>
    <p id="form-status" role="status" aria-live="polite" aria-label="${esc(copy.formStatus[l])}" class="status-line"></p>
    <p id="form-error" role="alert" aria-label="${esc(copy.formError[l])}" class="error-line"></p>
  </div>`;
  return layout({ locale, path, signedIn: session.signedIn, isStaff: false }, {
    title: copy.bookingLinkPage[l],
    heading: copy.bookingLinkPage[l],
    mainContent: main,
    bodyClass: 'page-booking-link',
  });
}

export function contactPage(locale: Locale, path: string, session: PageSession): string {
  const l = locale;
  const main = `  <div id="contact-page" class="auth-form">
    <label>${esc(copy.fullName[l])} <input type="text" id="enquiry-name"></label>
    <label>${esc(copy.email[l])} <input type="email" id="enquiry-email"></label>
    <label>${esc(copy.subject[l])} <input type="text" id="enquiry-subject"></label>
    <label>${esc(copy.message[l])} <textarea id="enquiry-message" rows="6"></textarea></label>
    <button type="button" id="enquiry-submit" class="primary-action">${esc(copy.sendEnquiry[l])}</button>
    <p id="form-status" role="status" aria-live="polite" aria-label="${esc(copy.formStatus[l])}" class="status-line"></p>
    <p id="form-error" role="alert" aria-label="${esc(copy.formError[l])}" class="error-line"></p>
  </div>`;
  return layout({ locale, path, signedIn: session.signedIn, isStaff: false }, {
    title: copy.contact[l],
    heading: copy.contact[l],
    mainContent: main,
    bodyClass: 'page-contact',
  });
}


