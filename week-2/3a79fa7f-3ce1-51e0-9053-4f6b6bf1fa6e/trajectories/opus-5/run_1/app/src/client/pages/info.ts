import { errorBody, post } from '../api.js';
import { el, formatCents } from '../dom.js';
import { announce, applyFieldErrors, disclosure, field, type FieldHandle } from '../ui.js';
import { FAQ_ROWS } from './home.js';

interface CountryRow {
  name: string;
  packageShipping: number;
  accessoryShipping: number;
  freeFrom: number | null;
  packedFee: number;
  aloneFee: number;
  tax: string;
  transitDays: number;
}

const COUNTRY_ROWS: CountryRow[] = [
  { name: 'United States', packageShipping: 0, accessoryShipping: 1500, freeFrom: 100000, packedFee: 2500, aloneFee: 4500, tax: '7.25%', transitDays: 2 },
  { name: 'Puerto Rico', packageShipping: 0, accessoryShipping: 1500, freeFrom: 100000, packedFee: 5500, aloneFee: 9500, tax: '11.5%', transitDays: 1 },
  { name: 'Canada', packageShipping: 39900, accessoryShipping: 3500, freeFrom: null, packedFee: 3500, aloneFee: 6500, tax: 'By province', transitDays: 4 },
  { name: 'Germany', packageShipping: 59900, accessoryShipping: 4500, freeFrom: null, packedFee: 4500, aloneFee: 8500, tax: '19%', transitDays: 3 },
  { name: 'France', packageShipping: 59900, accessoryShipping: 4500, freeFrom: null, packedFee: 4500, aloneFee: 8500, tax: '20%', transitDays: 2 },
  { name: 'Australia', packageShipping: 79900, accessoryShipping: 6500, freeFrom: null, packedFee: 7500, aloneFee: 12500, tax: '10%', transitDays: 6 },
];

const PROVINCE_ROWS: { letters: string; province: string; tax: string }[] = [
  { letters: 'A, C, E', province: 'Newfoundland and Labrador, Prince Edward Island, New Brunswick', tax: 'HST 15%' },
  { letters: 'B', province: 'Nova Scotia', tax: 'HST 14%' },
  { letters: 'K, L, M, N, P', province: 'Ontario', tax: 'HST 13%' },
  { letters: 'G, H, J', province: 'Quebec', tax: 'GST 5%, QST 9.975%' },
  { letters: 'R, V', province: 'Manitoba, British Columbia', tax: 'GST 5%, PST 7%' },
  { letters: 'S', province: 'Saskatchewan', tax: 'GST 5%, PST 6%' },
  { letters: 'T, X, Y', province: 'Alberta, Northwest Territories and Nunavut, Yukon', tax: 'GST 5%' },
];

export function renderShipping(main: HTMLElement): void {
  const headers = [
    'Country',
    'Board shipping',
    'Accessory shipping',
    'Free accessory shipping from',
    'Dangerous goods fee per spare packed with a board',
    'Dangerous goods fee per spare shipped alone',
    'Tax',
    'Arrives in',
  ];

  main.replaceChildren(
    el('section', { class: 'band wrap stack' }, [
      el('h1', {}, 'Shipping and fees'),
      el('p', {}, 'In-stock orders ship the same business day when you order before 14:00 warehouse time, and the next business day after that. Arrival is counted in business days from the ship date.'),
      el('p', {}, 'Spare batteries ship at 30% charge or less.'),
      el('div', { class: 'table-scroll' }, el('table', {}, [
        el('thead', {}, el('tr', {}, headers.map((header) => el('th', { scope: 'col' }, header)))),
        el('tbody', {}, COUNTRY_ROWS.map((row) =>
          el('tr', {}, [
            el('th', { scope: 'row' }, row.name),
            el('td', {}, formatCents(row.packageShipping)),
            el('td', {}, formatCents(row.accessoryShipping)),
            el('td', {}, row.freeFrom === null ? 'Not offered' : formatCents(row.freeFrom)),
            el('td', {}, formatCents(row.packedFee)),
            el('td', {}, formatCents(row.aloneFee)),
            el('td', {}, row.tax),
            el('td', {}, `${row.transitDays} business days`),
          ]),
        )),
      ])),
      el('h2', {}, 'Canadian tax by province'),
      el('div', { class: 'table-scroll' }, el('table', {}, [
        el('thead', {}, el('tr', {}, ['Postal code starts with', 'Province or territory', 'Tax'].map((header) => el('th', { scope: 'col' }, header)))),
        el('tbody', {}, PROVINCE_ROWS.map((row) =>
          el('tr', {}, [el('th', { scope: 'row' }, row.letters), el('td', {}, row.province), el('td', {}, row.tax)]),
        )),
      ])),
      el('h2', {}, 'Dangerous goods'),
      el('p', {}, 'A spare battery packed in the board box ships under UN3481. A battery shipped on its own ships under UN3480 and carries the higher fee.'),
    ]),
  );
}

export function renderProtection(main: HTMLElement): void {
  main.replaceChildren(
    el('section', { class: 'band wrap stack narrow' }, [
      el('h1', {}, 'Protection plans'),
      el('p', {}, 'Every board carries a one-year warranty, two years in Germany and France, and every battery eighteen months. A protection plan extends the board cover.'),
      el('div', { class: 'grid grid-2' }, [
        el('article', { class: 'card stack' }, [el('h2', { style: 'font-size:1.2rem' }, '2 years'), el('p', {}, formatCents(79900))]),
        el('article', { class: 'card stack' }, [el('h2', { style: 'font-size:1.2rem' }, '3 years'), el('p', {}, formatCents(129900))]),
      ]),
      el('p', {}, 'Add protection from your order page within 30 days of placing the order. Tax follows your order country.'),
    ]),
  );
}

export function renderFaq(main: HTMLElement): void {
  main.replaceChildren(
    el('section', { class: 'band wrap stack narrow' }, [
      el('h1', {}, 'Rider questions'),
      el('div', {}, FAQ_ROWS.map((row) => disclosure(row.question, row.answer))),
    ]),
  );
}

export function renderPartners(main: HTMLElement): void {
  const businessName = field('Business name', 'text');
  const email = field('Email', 'text', { type: 'email' });
  const country = field('Country code', 'text', { helper: 'Two capital letters, like US' });
  const kind = field('Partner type', 'select', {
    options: [
      { value: 'dealer', label: 'Dealer' },
      { value: 'wholesale', label: 'Wholesale' },
      { value: 'affiliate', label: 'Affiliate' },
    ],
  });
  const website = field('Website', 'text', { helper: 'Optional, starting with http:// or https://' });
  const submit = el('button', { class: 'btn', type: 'button' }, 'Apply');
  const alert = el('div', { class: 'alert-region', role: 'alert' });
  const done = el('p', { role: 'status' });

  const handles: Record<string, FieldHandle> = {
    business_name: businessName,
    email,
    country,
    kind,
    website,
  };

  submit.addEventListener('click', async () => {
    alert.textContent = '';
    done.textContent = 'Sending...';
    submit.disabled = true;
    const result = await post('/api/partner-applications', {
      business_name: businessName.control.value,
      email: email.control.value,
      country: country.control.value,
      kind: kind.control.value,
      website: website.control.value,
    });
    submit.disabled = false;
    if (!result.ok) {
      done.textContent = '';
      const body = errorBody(result);
      applyFieldErrors(handles, body.fields);
      if (!body.fields) alert.textContent = body.message;
      return;
    }
    done.textContent = 'Application received.';
    announce('Application received.');
  });

  main.replaceChildren(
    el('section', { class: 'band wrap stack narrow' }, [
      el('h1', {}, 'Sell or rent Tern boards'),
      el('p', {}, 'We work with a small number of dealers, wholesalers and affiliates in the six countries we ship to.'),
      el('form', { novalidate: true }, [alert, businessName.wrapper, email.wrapper, country.wrapper, kind.wrapper, website.wrapper, submit, done]),
    ]),
  );
}

export function renderPrivacy(main: HTMLElement): void {
  main.replaceChildren(
    el('section', { class: 'band wrap stack narrow' }, [
      el('h1', {}, 'Privacy policy'),
      el('p', {}, 'We keep the details you give us to quote builds, take orders, run demo days, answer support cases and send the notices you ask for. We store them in our own database and nowhere else.'),
      el('p', {}, 'We do not sell your details. We do not load scripts, fonts, images or map tiles from other sites, so no other company sees your visit.'),
      el('p', {}, 'Order records are kept for as long as the warranty runs. Newsletter signups are kept until you ask us to remove them. Write to the workshop to ask what we hold or to have it removed.'),
      el('p', {}, 'Sessions are held in an HttpOnly cookie. We also keep a cookie for a guest cart so your build survives a reload.'),
    ]),
  );
}

export function renderNotFound(main: HTMLElement): void {
  main.replaceChildren(
    el('section', { class: 'band wrap stack narrow' }, [
      el('h1', {}, 'Page not found'),
      el('p', {}, 'That address is not part of the Tern Foils storefront.'),
      el('a', { href: '/', class: 'btn' }, 'Back to home'),
    ]),
  );
}
