import { ensureShell } from '../cockpit/shell.js';
import { home } from '../cockpit/home.js';
import { account } from '../cockpit/account.js';
import { sendPayment } from '../cockpit/send.js';
import { recipients, newRecipient } from '../cockpit/recipients.js';
import { approvals } from '../cockpit/approvals.js';
import { payments, invoices, loans, cards, treasuryAccount, billPay } from '../cockpit/ledger_pages.js';

export { ensureShell };

export const pages = {
  home,
  account,
  sendPayment,
  recipients,
  newRecipient,
  approvals,
  payments,
  invoices,
  loans,
  cards,
  treasuryAccount,
  billPay,
};
