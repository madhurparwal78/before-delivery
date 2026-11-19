/** Cockpit entry: sign-in guard, shell, then the page for this address. */
import { loginAddress, storedToken } from "../shared/session.js";
import { SignedOut, Unreachable } from "../shared/api.js";
import { refreshFailed } from "../shared/outage.js";
import { after, every } from "../shared/timers.js";
import { mountAccount, accountIdFromPath } from "../cockpit/account.js";
import { mountApprovals } from "../cockpit/approvals.js";
import { mountHome } from "../cockpit/home.js";
import { mountInvoices } from "../cockpit/invoices.js";
import { mountLoans } from "../cockpit/loans.js";
import { installPalette } from "../cockpit/palette.js";
import { mountPayments } from "../cockpit/payments.js";
import { mountPlaceholder } from "../cockpit/placeholder.js";
import { mountRecipientForm, mountRecipients } from "../cockpit/recipients.js";
import { Refresher, refreshRail, startLive, onLiveReconnect, onLiveTransaction } from "../cockpit/refresh.js";
import { mountSearch } from "../cockpit/search.js";
import { mountSendPayment } from "../cockpit/send-payment.js";
import { mountShell, paintAvatar } from "../cockpit/shell.js";
import { loadAccounts, loadMe, loadWaiting, store } from "../cockpit/store.js";
import { query } from "../shared/dom.js";

const PAGES: Record<string, (root: HTMLElement) => void> = {
  home: mountHome,
  account: mountAccount,
  payments: mountPayments,
  "send-payment": mountSendPayment,
  recipients: mountRecipients,
  "recipient-new": mountRecipientForm,
  approvals: mountApprovals,
  invoices: mountInvoices,
  loans: mountLoans,
  cards: mountPlaceholder,
  "treasury-account": mountPlaceholder,
  "bill-pay": mountPlaceholder,
};

const RAIL_REFRESH_MS = 5_000;

async function start(root: HTMLElement, page: string, renderRail: () => void): Promise<void> {
  try {
    await Promise.all([loadMe(), loadAccounts(), loadWaiting()]);
  } catch (error) {
    if (error instanceof SignedOut) return;
    if (error instanceof Unreachable) {
      refreshFailed();
      after(() => void start(root, page, renderRail), RAIL_REFRESH_MS);
      return;
    }
    throw error;
  }
  paintAvatar();
  renderRail();
  startLive();
  const rail = new Refresher(refreshRail);
  every(() => void rail.run(), RAIL_REFRESH_MS);
  onLiveTransaction(() => void rail.run());
  onLiveReconnect(() => void rail.run());
  PAGES[page]?.(root);
}

function boot(): void {
  const page = document.body.dataset.page ?? "";
  const root = query(document, "[data-page-root]");
  installPalette();
  mountSearch();
  const shell = mountShell({
    activeAccountId: () => (page === "home" ? (store.accounts[0]?.id ?? null) : page === "account" ? accountIdFromPath() : null),
  });
  void start(root, page, shell.renderRail);
}

if (!storedToken()) {
  location.replace(loginAddress(location.pathname + location.search));
} else {
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
  boot();
}
