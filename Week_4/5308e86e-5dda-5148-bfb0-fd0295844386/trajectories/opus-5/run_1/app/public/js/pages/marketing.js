import { el } from '../dom.js';
import { marketingPage } from './layout.js';
import { home } from './home.js';
import {
  businessBanking,
  businessPayments,
  credit,
  treasury,
  invoicing,
  spendManagement,
  payroll,
  books,
  ventureDebt,
  workingCapitalLoans,
} from './products.js';
import { pricing } from './pricing.js';
import { contact } from './contact.js';
import { demo } from './demo.js';
import { login, signup } from './auth.js';

const notFound = {
  title: 'Page not found — Tallwind',
  render() {
    return marketingPage([
      el('div', { class: 'wrap section' }, [
        el('h1', { text: 'We could not find that page' }),
        el('p', { text: 'The address you asked for is not part of Tallwind.' }),
        el('a', { class: 'pill', href: '/', text: 'Back to the home page' }),
      ]),
    ]);
  },
};

export const pages = {
  home,
  businessBanking,
  businessPayments,
  credit,
  treasury,
  invoicing,
  spendManagement,
  payroll,
  books,
  ventureDebt,
  workingCapitalLoans,
  pricing,
  contact,
  demo,
  login,
  signup,
  notFound,
};
