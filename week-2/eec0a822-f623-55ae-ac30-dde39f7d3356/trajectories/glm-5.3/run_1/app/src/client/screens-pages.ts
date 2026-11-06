import { api, ApiError, errorCopy } from './api.js';
import { h, qs, announce, openDialog } from './ui.js';
import { fmtDateOnly, fmtDateTime } from '../shared/bases.js';
import { pageShell, endedPage, notFoundPage } from './screens-public.js';

const COUNTRIES: Array<[string, string]> = [
  ['GB', 'United Kingdom'], ['GR', 'Greece'], ['HR', 'Croatia'], ['DE', 'Germany'],
];
// The full ISO 3166-1 list, alphabetical by English name.
const ISO_COUNTRIES: Array<[string, string]> = [
  ['AF', 'Afghanistan'], ['AX', 'Åland Islands'], ['AL', 'Albania'], ['DZ', 'Algeria'], ['AS', 'American Samoa'], ['AD', 'Andorra'], ['AO', 'Angola'], ['AI', 'Anguilla'], ['AQ', 'Antarctica'], ['AG', 'Antigua and Barbuda'], ['AR', 'Argentina'], ['AM', 'Armenia'], ['AW', 'Aruba'], ['AU', 'Australia'], ['AT', 'Austria'], ['AZ', 'Azerbaijan'], ['BS', 'Bahamas'], ['BH', 'Bahrain'], ['BD', 'Bangladesh'], ['BB', 'Barbados'], ['BY', 'Belarus'], ['BE', 'Belgium'], ['BZ', 'Belize'], ['BJ', 'Benin'], ['BM', 'Bermuda'], ['BT', 'Bhutan'], ['BO', 'Bolivia'], ['BQ', 'Bonaire, Sint Eustatius and Saba'], ['BA', 'Bosnia and Herzegovina'], ['BW', 'Botswana'], ['BV', 'Bouvet Island'], ['BR', 'Brazil'], ['IO', 'British Indian Ocean Territory'], ['BN', 'Brunei Darussalam'], ['BG', 'Bulgaria'], ['BF', 'Burkina Faso'], ['BI', 'Burundi'], ['CV', 'Cabo Verde'], ['KH', 'Cambodia'], ['CM', 'Cameroon'], ['CA', 'Canada'], ['KY', 'Cayman Islands'], ['CF', 'Central African Republic'], ['TD', 'Chad'], ['CL', 'Chile'], ['CN', 'China'], ['CX', 'Christmas Island'], ['CC', 'Cocos (Keeling) Islands'], ['CO', 'Colombia'], ['KM', 'Comoros'], ['CG', 'Congo'], ['CD', 'Congo (Democratic Republic of the)'], ['CK', 'Cook Islands'], ['CR', 'Costa Rica'], ['CI', 'Côte d\'Ivoire'], ['HR', 'Croatia'], ['CU', 'Cuba'], ['CW', 'Curaçao'], ['CY', 'Cyprus'], ['CZ', 'Czechia'], ['DK', 'Denmark'], ['DJ', 'Djibouti'], ['DM', 'Dominica'], ['DO', 'Dominican Republic'], ['EC', 'Ecuador'], ['EG', 'Egypt'], ['SV', 'El Salvador'], ['GQ', 'Equatorial Guinea'], ['ER', 'Eritrea'], ['EE', 'Estonia'], ['SZ', 'Eswatini'], ['ET', 'Ethiopia'], ['FK', 'Falkland Islands (Malvinas)'], ['FO', 'Faroe Islands'], ['FJ', 'Fiji'], ['FI', 'Finland'], ['FR', 'France'], ['GF', 'French Guiana'], ['PF', 'French Polynesia'], ['TF', 'French Southern Territories'], ['GA', 'Gabon'], ['GM', 'Gambia'], ['GE', 'Georgia'], ['DE', 'Germany'], ['GH', 'Ghana'], ['GI', 'Gibraltar'], ['GR', 'Greece'], ['GL', 'Greenland'], ['GD', 'Grenada'], ['GP', 'Guadeloupe'], ['GU', 'Guam'], ['GT', 'Guatemala'], ['GG', 'Guernsey'], ['GN', 'Guinea'], ['GW', 'Guinea-Bissau'], ['GY', 'Guyana'], ['HT', 'Haiti'], ['HM', 'Heard Island and McDonald Islands'], ['VA', 'Holy See'], ['HN', 'Honduras'], ['HK', 'Hong Kong'], ['HU', 'Hungary'], ['IS', 'Iceland'], ['IN', 'India'], ['ID', 'Indonesia'], ['IR', 'Iran'], ['IQ', 'Iraq'], ['IE', 'Ireland'], ['IM', 'Isle of Man'], ['IL', 'Israel'], ['IT', 'Italy'], ['JM', 'Jamaica'], ['JP', 'Japan'], ['JE', 'Jersey'], ['JO', 'Jordan'], ['KZ', 'Kazakhstan'], ['KE', 'Kenya'], ['KI', 'Kiribati'], ['KP', 'Korea (Democratic People\'s Republic of)'], ['KR', 'Korea (Republic of)'], ['KW', 'Kuwait'], ['KG', 'Kyrgyzstan'], ['LA', 'Lao People\'s Democratic Republic'], ['LV', 'Latvia'], ['LB', 'Lebanon'], ['LS', 'Lesotho'], ['LR', 'Liberia'], ['LY', 'Libya'], ['LI', 'Liechtenstein'], ['LT', 'Lithuania'], ['LU', 'Luxembourg'], ['MO', 'Macao'], ['MG', 'Madagascar'], ['MW', 'Malawi'], ['MY', 'Malaysia'], ['MV', 'Maldives'], ['ML', 'Mali'], ['MT', 'Malta'], ['MH', 'Marshall Islands'], ['MQ', 'Martinique'], ['MR', 'Mauritania'], ['MU', 'Mauritius'], ['YT', 'Mayotte'], ['MX', 'Mexico'], ['FM', 'Micronesia'], ['MD', 'Moldova'], ['MC', 'Monaco'], ['MN', 'Mongolia'], ['ME', 'Montenegro'], ['MS', 'Montserrat'], ['MA', 'Morocco'], ['MZ', 'Mozambique'], ['MM', 'Myanmar'], ['NA', 'Namibia'], ['NR', 'Nauru'], ['NP', 'Nepal'], ['NL', 'Netherlands'], ['NC', 'New Caledonia'], ['NZ', 'New Zealand'], ['NI', 'Nicaragua'], ['NE', 'Niger'], ['NG', 'Nigeria'], ['NU', 'Niue'], ['NF', 'Norfolk Island'], ['MK', 'North Macedonia'], ['MP', 'Northern Mariana Islands'], ['NO', 'Norway'], ['OM', 'Oman'], ['PK', 'Pakistan'], ['PW', 'Palau'], ['PS', 'Palestine, State of'], ['PA', 'Panama'], ['PG', 'Papua New Guinea'], ['PY', 'Paraguay'], ['PE', 'Peru'], ['PH', 'Philippines'], ['PN', 'Pitcairn'], ['PL', 'Poland'], ['PT', 'Portugal'], ['PR', 'Puerto Rico'], ['QA', 'Qatar'], ['RE', 'Réunion'], ['RO', 'Romania'], ['RU', 'Russian Federation'], ['RW', 'Rwanda'], ['BL', 'Saint Barthélemy'], ['SH', 'Saint Helena, Ascension and Tristan da Cunha'], ['KN', 'Saint Kitts and Nevis'], ['LC', 'Saint Lucia'], ['MF', 'Saint Martin (French part)'], ['PM', 'Saint Pierre and Miquelon'], ['VC', 'Saint Vincent and the Grenadines'], ['WS', 'Samoa'], ['SM', 'San Marino'], ['ST', 'Sao Tome and Principe'], ['SA', 'Saudi Arabia'], ['SN', 'Senegal'], ['RS', 'Serbia'], ['SC', 'Seychelles'], ['SL', 'Sierra Leone'], ['SG', 'Singapore'], ['SX', 'Sint Maarten (Dutch part)'], ['SK', 'Slovakia'], ['SI', 'Slovenia'], ['SB', 'Solomon Islands'], ['SO', 'Somalia'], ['ZA', 'South Africa'], ['GS', 'South Georgia and the South Sandwich Islands'], ['SS', 'South Sudan'], ['ES', 'Spain'], ['LK', 'Sri Lanka'], ['SD', 'Sudan'], ['SR', 'Suriname'], ['SJ', 'Svalbard and Jan Mayen'], ['SE', 'Sweden'], ['CH', 'Switzerland'], ['SY', 'Syrian Arab Republic'], ['TW', 'Taiwan'], ['TJ', 'Tajikistan'], ['TZ', 'Tanzania'], ['TH', 'Thailand'], ['TL', 'Timor-Leste'], ['TG', 'Togo'], ['TK', 'Tokelau'], ['TO', 'Tonga'], ['TT', 'Trinidad and Tobago'], ['TN', 'Tunisia'], ['TR', 'Türkiye'], ['TM', 'Turkmenistan'], ['TC', 'Turks and Caicos Islands'], ['TV', 'Tuvalu'], ['UG', 'Uganda'], ['UA', 'Ukraine'], ['AE', 'United Arab Emirates'], ['GB', 'United Kingdom'], ['US', 'United States of America'], ['UM', 'United States Minor Outlying Islands'], ['UY', 'Uruguay'], ['UZ', 'Uzbekistan'], ['VU', 'Vanuatu'], ['VE', 'Venezuela'], ['VN', 'Viet Nam'], ['VG', 'Virgin Islands (British)'], ['VI', 'Virgin Islands (U.S.)'], ['WF', 'Wallis and Futuna'], ['EH', 'Western Sahara'], ['YE', 'Yemen'], ['ZM', 'Zambia'], ['ZW', 'Zimbabwe'],
];

export async function manifestPageScreen(token: string): Promise<HTMLElement> {
  let data: any;
  try {
    data = await api<any>(`/api/manifest/${token}`);
  } catch (err) {
    const e = err as ApiError;
    if (e.status === 410) return endedPage(null);
    if (e.status === 404) return notFoundPage();
    throw err;
  }
  const guests: any[] = data.guests;
  const form = h('form', { id: 'manifest-form', novalidate: true, onsubmit: (e: Event) => e.preventDefault() });
  const msgBox = h('div', {});
  const fieldsets: HTMLElement[] = [];

  const buildGuest = (g: any, n: number) => {
    const fs = h('fieldset', { class: 'card' });
    fs.setAttribute('role', 'group');
    fs.setAttribute('aria-label', `Guest ${n}`);
    const fullName = h('input', { 'aria-label': 'Full name', value: g.fullName });
    const nat = h('select', { 'aria-label': 'Nationality' }, h('option', { value: '' }, 'Choose a country'));
    for (const [code, name] of ISO_COUNTRIES) {
      nat.append(h('option', { value: code }, name));
    }
    nat.value = g.nationality ?? '';
    const dob = h('input', { type: 'text', 'aria-label': 'Date of birth', placeholder: 'YYYY-MM-DD' });
    const passport = h('input', { type: 'text', 'aria-label': 'Passport number' });
    const notes = h('p', { class: 'num' });
    const renderNotes = () => {
      notes.textContent = '';
      if (g.passportOnFile) notes.append(h('span', {}, 'Passport details on file'), h('br', {}));
      if (g.photoOnFile) notes.append(h('span', {}, 'Photo on file'));
    };
    renderNotes();
    const photoInput = h('input', { type: 'file', 'aria-label': `Passport photo for ${g.fullName}`, accept: 'image/jpeg,image/png', style: 'display:none' });
    const photoBtn = h('button', { type: 'button' }, `Add passport photo for ${g.fullName}`);
    const photoMsg = h('span', { class: 'num', style: 'margin-left:0.6rem' });
    photoBtn.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', async () => {
      const f = (photoInput as HTMLInputElement).files?.[0];
      if (!f) return;
      if (f.size > 5000000) {
        const copy = 'That photo is larger than 5,000,000 bytes.';
        photoMsg.textContent = copy;
        announce(copy);
        return;
      }
      photoBtn.disabled = true;
      photoBtn.textContent = 'Uploading photo';
      announce('Uploading photo');
      const fd = new FormData();
      fd.append('photo', f);
      try {
        await api(`/api/manifest/${token}/guests/${g.id}/photo`, { method: 'POST', body: fd });
        const copy = `Passport photo saved for ${g.fullName}.`;
        g.photoOnFile = true;
        photoMsg.textContent = copy;
        announce(copy);
        renderNotes();
      } catch (err) {
        const e = err as ApiError;
        const copy = errorCopy(e);
        photoMsg.textContent = copy.message;
        announce(copy.message);
      } finally {
        photoBtn.disabled = false;
        photoBtn.textContent = `Add passport photo for ${g.fullName}`;
        photoInput.value = '';
      }
    });
    fs.append(
      h('legend', { class: 'num' }, `Guest ${n}`),
      h('div', { class: 'field' }, h('label', {}, 'Full name'), fullName),
      h('div', { class: 'field' }, h('label', {}, 'Nationality'), nat),
      h('div', { class: 'field' }, h('label', {}, 'Date of birth'), dob),
      h('div', { class: 'field' }, h('label', {}, 'Passport number'), passport),
      notes,
      photoBtn,
      photoInput,
      photoMsg,
    );
    fieldsets.push(fs);
    return { fs, guest: g, fullName, nat, dob, passport };
  };

  const entries = guests.map((g, i) => buildGuest(g, i + 1));
  for (const e of entries) form.append(e.fs);

  const addGuest = h('button', { type: 'button' }, 'Add guest');
  addGuest.addEventListener('click', () => {
    openDialog('Add guest', (panel, ctrl) => {
      const name = h('input', { 'aria-label': 'Full name' });
      const err2 = h('div', {});
      const btn = h('button', { class: 'primary' }, 'Add guest');
      const cancel = h('button', { onclick: () => ctrl.close() }, 'Cancel');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Adding guest';
        try {
          const res = await api<any>(`/api/manifest/${token}/guests`, { method: 'POST', body: JSON.stringify({ fullName: name.value }) });
          const copy = `${res.guest.fullName} added.`;
          announce(copy);
          ctrl.close();
          const entry = buildGuest(res.guest, entries.length + 1);
          entries.push(entry);
          form.insertBefore(entry.fs, form.firstChild);
        } catch (err) {
          const e = err as ApiError;
          btn.disabled = false;
          btn.textContent = 'Add guest';
          const copy = errorCopy(e);
          err2.textContent = '';
          err2.append(h('p', { class: 'msg err' }, copy.message));
          announce(copy.message);
        }
      });
      panel.append(
        h('h2', {}, 'Add guest'),
        h('div', { class: 'field' }, h('label', {}, 'Full name'), name),
        err2,
        h('div', { style: 'display:flex;gap:0.6rem' }, btn, cancel),
      );
    }, { sheet: window.innerWidth < 1024 });
  });

  const save = h('button', { class: 'primary', type: 'submit', form: 'manifest-form' }, 'Save manifest');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true;
    save.textContent = 'Saving manifest';
    announce('Saving manifest');
    const payload = entries.map((e2) => ({
      id: e2.guest.id,
      fullName: e2.fullName.value,
      nationality: e2.nat.value,
      dateOfBirth: e2.dob.value,
      passportNumber: e2.passport.value,
    }));
    try {
      await api(`/api/manifest/${token}/guests`, { method: 'PUT', body: JSON.stringify({ guests: payload }) });
      const copy = 'Manifest saved.';
      message('ok', copy, msgBox);
      announce(copy);
    } catch (err) {
      const e2 = err as ApiError;
      const copy = errorCopy(e2);
      message('err', copy.message || 'Something went wrong — nothing was changed. Try again.', msgBox);
      announce(copy.message);
    } finally {
      save.disabled = false;
      save.textContent = 'Save manifest';
    }
  });

  const sticky = h('div', { class: 'stickybar' }, save);
  return pageShell([
    h('h1', {}, `Guest manifest for ${data.yachtName}`),
    h('p', { class: 'num' }, `Week of ${fmtDateOnly('split', data.weekStart)} to ${fmtDateOnly('split', data.weekEnd)}`),
    h('p', { class: 'num' }, `This yacht takes at most ${data.maxGuests} guests.`),
    msgBox,
    form,
    addGuest,
    sticky,
  ]);
}

function message(kind: 'ok' | 'err', text: string, box: HTMLElement): void {
  box.textContent = '';
  box.append(h('p', { class: `msg ${kind}`, role: 'status' }, text));
}

// ---------------- broker page (public) ----------------

export async function brokerPageScreen(token: string): Promise<HTMLElement> {
  let data: any;
  try {
    data = await api<any>(`/api/broker/${token}`);
  } catch (err) {
    const e = err as ApiError;
    if (e.status === 410) return endedPage(null);
    if (e.status === 404) return notFoundPage();
    throw err;
  }
  const holdsTable = h('table', { 'aria-label': 'Your holds' });
  const msgBox = h('div', {});

  const render = async () => {
    const fresh = await api<any>(`/api/broker/${token}`);
    holdsTable.textContent = '';
    const tbody = h('tbody', {});
    if (fresh.holds.length === 0) {
      tbody.append(h('tr', {}, h('td', { colspan: '5' }, 'No holds yet.')));
    }
    for (const hold of fresh.holds) {
      tbody.append(h('tr', {},
        h('td', {}, hold.clientName),
        h('td', {}, hold.yachtSlug),
        h('td', {}, fmtDateOnly('split', hold.weekStart)),
        h('td', {}, hold.status === 'waiting' ? `Waiting, ${hold.position} in line` : hold.status === 'live' ? 'Live' : hold.status === 'lapsed' ? 'Lapsed' : hold.status === 'released' ? 'Released' : 'Charter'),
        h('td', { class: 'num' }, hold.lapsesAt ? fmtDateTime('split', { ms: Date.parse(hold.lapsesAt) }) : '—'),
      ));
    }
    holdsTable.append(h('thead', {}, h('tr', {}, ...['Client', 'Yacht', 'Week', 'Status', 'Lapses'].map((c) => h('th', { scope: 'col' }, c)))), tbody);
    return fresh;
  };
  await render();
  window.setInterval(() => { void render(); }, 10000);

  const sections: HTMLElement[] = [];
  for (const y of data.yachts) {
    const weeks = h('ul', { 'aria-label': `Weeks for ${y.name}`, style: 'list-style:none;padding:0;display:contents' });
    for (const w of y.weeks) {
      const li = h('li', { class: 'card', style: 'min-width:220px' },
        h('p', {}, `Week of ${fmtDateOnly('split', w.weekStart)}`),
        h('span', { class: `status-chip ${w.status}` }, w.status === 'free' ? 'Free' : w.status === 'held' ? 'Held' : 'Booked'),
        h('p', { class: 'num' }, fmtMoney(w.weeklyRateMinor, w.currency)),
      );
      if (w.status !== 'booked') {
        const btn = h('button', {}, `Hold ${y.name}, week of ${fmtDateOnly('split', w.weekStart)}`);
        btn.addEventListener('click', () => {
          openDialog('Hold for a client', (panel, ctrl) => {
            const name = h('input', { 'aria-label': 'Client name' });
            const err2 = h('div', {});
            const queue = w.status === 'held';
            const btn2 = h('button', { class: 'primary' }, queue ? 'Join the line' : 'Place hold');
            const cancel = h('button', { onclick: () => ctrl.close() }, 'Cancel');
            btn2.addEventListener('click', async () => {
              btn2.disabled = true;
              btn2.textContent = 'Placing hold';
              announce('Placing hold');
              try {
                await api(`/api/broker/${token}/holds`, {
                  method: 'POST',
                  body: JSON.stringify({ yachtSlug: y.slug, weekStart: w.weekStart, clientName: name.value, queue }),
                });
                ctrl.close();
                await render();
              } catch (err) {
                const e = err as ApiError;
                btn2.disabled = false;
                btn2.textContent = queue ? 'Join the line' : 'Place hold';
                const copy = errorCopy(e, { takenAt: e.body?.takenAt ? fmtDateTime('split', { ms: Date.parse(e.body.takenAt) }) : undefined });
                err2.textContent = '';
                err2.append(h('p', { class: 'msg err' }, copy.message));
                announce(copy.message);
              }
            });
            panel.append(
              h('h2', {}, 'Hold for a client'),
              h('div', { class: 'field' }, h('label', {}, 'Client name'), name),
              err2,
              h('div', { style: 'display:flex;gap:0.6rem' }, btn2, cancel),
            );
          }, { sheet: window.innerWidth < 1024 });
        });
        li.append(btn);
      }
      weeks.append(li);
    }
    sections.push(h('section', {},
      h('h2', {}, y.name),
      h('div', { class: 'strip-wrap' }, h('div', { class: 'strip cards-col', tabindex: '0' }, weeks)),
    ));
  }

  return pageShell([
    h('h1', {}, `Availability for ${data.broker.name}`),
    h('p', { class: 'num' }, `${data.company.name} · page works until ${fmtDateTime('split', { ms: Date.parse(data.endsAt) })}`),
    ...sections,
    h('h2', {}, 'Your holds'),
    holdsTable,
    msgBox,
  ]);
}

import { fmtMoney } from '../shared/bases.js';
