import { el, bannerAlert } from './ui.js';
import { get, post, clinicTime, clinicDayShort, clinicDayMonth, clinicDate, ApiRequestFailed } from './api.js';
import { announcer } from './live.js';

const REASONS = ['Check-up', 'Vaccination', 'Limping or injury', 'Off their food'];

export function renderPublicBooking(root: HTMLElement, slug: string, petToken: string | null): void {
  const state = {
    clinic: null as any,
    reason: 'Check-up',
    day: '',
    slots: [] as { start: string; vetId: string; vetName: string }[],
    chosen: null as { start: string; vetId: string; vetName: string } | null,
    pet: null as any,
    ownerName: '',
    ownerEmail: '',
    petName: '',
    species: 'dog',
    busy: false,
    refreshTimer: null as number | null,
    fetchToken: 0,
  };

  root.textContent = '';

  const wrap = el('div', {});

  // sticky header
  const sticky = el('div', { class: 'public-sticky' });
  const clinicName = el('span', { class: 'clinic', text: '' });
  const bookVisitBtn = el('button', { class: 'pill pill-primary' }, 'Book a visit');
  sticky.append(clinicName, el('span', { style: 'flex:1' }), bookVisitBtn);
  wrap.append(sticky);

  // hero
  const hero = el('section', { class: 'split-band' });
  const heroLeft = el('div', { class: 'band-left' });
  const heroClinic = el('h2', { class: 'headline', style: 'font-size:22px', text: '' });
  const heroTitle = el('h1', { class: 'screen-headline', text: 'Book a visit for your animal' });
  const chooseTimeBtn = el('button', { class: 'pill pill-primary' }, 'Choose a time');
  heroLeft.append(heroClinic, heroTitle, chooseTimeBtn);
  const heroRight = el('div', { class: 'illustration' });
  const illus = el('div', { 'aria-hidden': 'true', style: 'display:flex;gap:10px;align-items:center' });
  for (const c of ['#9fe3c9', '#4aa3ff', '#fbe4ec']) {
    illus.append(el('span', { style: `width:64px;height:88px;border-radius:18px;background:${c};display:inline-block` }));
  }
  illus.append(el('span', { style: 'font-size:56px' }, '🐾'));
  heroRight.append(illus);
  const strip = el('div', { class: 'strip' }, el('span', { class: 'a' }), el('span', { class: 'b' }));
  hero.append(heroLeft, heroRight, strip);
  wrap.append(hero);

  const main = el('main', { style: 'display:flex;flex-direction:column;gap:28px;padding:28px clamp(16px,5vw,48px)' });

  // reason cards
  const reasonGroup = el('div', { role: 'radiogroup', 'aria-label': 'Reason for visit', class: 'reason-cards' });
  for (const reason of REASONS) {
    const card = el('button', {
      role: 'radio',
      class: 'reason-card',
      'aria-label': reason,
      'aria-checked': String(reason === state.reason),
      onclick: () => {
        state.reason = reason;
        reasonGroup.querySelectorAll('button').forEach((b) => {
          b.setAttribute('aria-checked', String(b === card));
          const mark = b.querySelector('.mark');
          if (mark) mark.textContent = b === card ? 'Chosen' : '';
        });
        void refreshSlots();
      },
    });
    const icon = el('span', { 'aria-hidden': 'true', style: 'font-size:22px' }, reason === 'Check-up' ? '🩺' : reason === 'Vaccination' ? '💉' : reason === 'Limping or injury' ? '🦴' : '🍽️');
    card.append(icon, el('span', { class: 'label', text: reason }), el('span', { class: 'mark', text: reason === state.reason ? 'Chosen' : '' }));
    reasonGroup.append(card);
  }
  main.append(reasonGroup);

  const petBanner = el('p', {});
  main.append(petBanner);

  // booking form
  const form = el('section', { class: 'card', style: 'max-width:640px' });
  const dayInput = el('input', { class: 'input-pill', type: 'date', 'aria-label': 'Day' }) as HTMLInputElement;
  const timesGroup = el('div', { role: 'group' });
  const chosenStatus = el('p', { role: 'status', 'aria-label': 'Chosen time', text: 'No time chosen yet.' });
  const detailsWrap = el('div', { style: 'display:none;flex-direction:column;gap:12px' });
  const ownerName = el('input', { class: 'input-pill', 'aria-label': 'Your name', type: 'text' }) as HTMLInputElement;
  const ownerEmail = el('input', { class: 'input-pill', 'aria-label': 'Email', type: 'email' }) as HTMLInputElement;
  const petName = el('input', { class: 'input-pill', 'aria-label': 'Pet name', type: 'text' }) as HTMLInputElement;
  const speciesSel = el('select', { class: 'input-pill', 'aria-label': 'Species' }) as HTMLSelectElement;
  for (const [v, l] of [['dog', 'Dog'], ['cat', 'Cat'], ['rabbit', 'Rabbit'], ['other', 'Other']]) speciesSel.append(new Option(l, v));
  const confirmBtn = el('button', { class: 'pill pill-solid' }, 'Confirm booking');
  const formErr = el('div', {});

  form.append(
    el('div', { class: 'field' }, el('label', { text: 'Day' }), dayInput),
    timesGroup,
    chosenStatus,
    detailsWrap,
    formErr,
    confirmBtn,
  );
  detailsWrap.append(
    el('div', { class: 'field' }, el('label', { text: 'Your name' }), ownerName),
    el('div', { class: 'field' }, el('label', { text: 'Email' }), ownerEmail),
    el('div', { class: 'field' }, el('label', { text: 'Pet name' }), petName),
    el('div', { class: 'field' }, el('label', { text: 'Species' }), speciesSel),
    confirmBtn,
  );

  main.append(form);

  // services tiles
  const services = el('section', { role: 'region', 'aria-label': 'Our services', class: 'services-tiles' });
  const servicesData = [
    { title: 'Consultations', text: 'Calm, unhurried consults with vets who know your animal.' },
    { title: 'Vaccinations', text: 'Routine and travel vaccines with reminders you can rely on.' },
    { title: 'Surgery', text: 'Modern theatres and a ward team that watches the clock for you.' },
    { title: 'In-house labs', text: 'Same-day bloods and cytology while you wait.' },
  ];
  for (const s of servicesData) {
    const tile = el('div', { class: 'service-tile' });
    tile.append(el('span', { 'aria-hidden': 'true', style: 'font-size:24px' }, '🐾'));
    tile.append(el('h3', { text: s.title }));
    tile.append(el('p', { style: 'margin:4px 0 0' }, s.text));
    services.append(tile);
  }
  main.append(services);

  // meet the vets
  const vetsBand = el('section', { role: 'region', 'aria-label': 'Meet the vets', class: 'vets-band' });
  const circles = el('div', { 'aria-hidden': 'true', style: 'display:flex;gap:10px;flex-wrap:wrap' });
  const quoteBox = el('div', {});
  vetsBand.append(circles, quoteBox);
  main.append(vetsBand);

  wrap.append(main);

  const footer = el('footer', { class: 'site-footer', role: 'contentinfo' });
  const footerNav = el('nav', { 'aria-label': 'Workspace links' });
  footerNav.append(el('a', { href: `/book/${slug}` }, 'Online booking'));
  footer.append(footerNav, el('p', { class: 'footer-tag' }, 'Roundbook by Larchmere Veterinary Systems'));
  wrap.append(footer);

  root.append(wrap);

  const scrollToDay = (): void => {
    dayInput.focus();
    dayInput.scrollIntoView({ block: 'center' });
  };
  bookVisitBtn.addEventListener('click', scrollToDay);
  chooseTimeBtn.addEventListener('click', scrollToDay);

  const refreshSlots = async (): Promise<void> => {
    const token = ++state.fetchToken;
    if (!state.day) return;
    try {
      const r = await get(`/api/public/clinics/${slug}/slots?date=${state.day}&reason=${encodeURIComponent(state.reason)}`);
      // an answer for an earlier choice that arrives late is discarded
      if (token !== state.fetchToken) return;
      if (r.date !== state.day) return;
      state.slots = r.slots;
      renderTimes();
    } catch {
      /* the day or reason is unknown; show no times */
      state.slots = [];
      renderTimes();
    }
  };

  const renderTimes = (): void => {
    timesGroup.textContent = '';
    for (const vet of state.clinic?.vets ?? []) {
      const group = el('div', { role: 'group', 'aria-label': vet.name, style: 'margin-bottom:12px' });
      group.append(el('h3', { style: 'font-size:16px', text: vet.name }));
      const row = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' });
      const vetSlots = state.slots.filter((s) => s.vetId === vet.id);
      if (vetSlots.length === 0) {
        row.append(el('p', { style: 'color:#5d6b77', text: 'No times are available on this day.' }));
      }
      for (const slot of vetSlots) {
        const time = clinicTime(slot.start);
        const btn = el('button', {
          class: 'btn',
          'aria-label': `${time} with ${vet.name}`,
          'aria-pressed': String(state.chosen?.start === slot.start && state.chosen?.vetId === vet.id),
          onclick: () => {
            state.chosen = slot;
            chosenStatus.textContent = `You chose ${time} with ${vet.name} on ${clinicDayShort(slot.start)} ${clinicDayMonth(slot.start)}.`;
            detailsWrap.style.display = 'flex';
            renderTimes();
          },
        }, `${time} with ${vet.name}`);
        row.append(btn);
      }
      group.append(row);
      timesGroup.append(group);
    }
  };

  dayInput.addEventListener('change', () => {
    state.day = dayInput.value;
    void refreshSlots();
  });

  confirmBtn.addEventListener('click', async () => {
    if (state.busy) return; // a second tap sends nothing
    if (!state.chosen) {
      formErr.textContent = '';
      formErr.append(bannerAlert('No time chosen yet.'));
      return;
    }
    state.busy = true;
    confirmBtn.setAttribute('aria-busy', 'true');
    confirmBtn.disabled = true;
    try {
      const booking = await post(`/api/public/clinics/${slug}/bookings`, {
        start: state.chosen.start,
        vetId: state.chosen.vetId,
        reason: state.reason,
        ownerName: ownerName.value,
        ownerEmail: ownerEmail.value,
        petName: petName.value,
        species: speciesSel.value,
        petToken: petToken ?? undefined,
      });
      window.location.href = `/book/${slug}/confirmation/${booking.code}`;
    } catch (e) {
      formErr.textContent = '';
      if (e instanceof ApiRequestFailed) {
        if (e.err.error === 'slot_taken') {
          state.chosen = null;
          chosenStatus.textContent = e.err.message;
          void refreshSlots();
        } else {
          formErr.append(bannerAlert(e.err.message));
        }
      }
    } finally {
      state.busy = false;
      confirmBtn.removeAttribute('aria-busy');
      confirmBtn.disabled = false;
    }
  });

  // 15-second refresh keeps the chosen time and typed fields
  state.refreshTimer = window.setInterval(() => {
    void refreshSlots();
  }, 15000);

  void (async () => {
    const timeR = await get('/api/time');
    state.day = clinicDate(timeR.now);
    dayInput.value = state.day;
    dayInput.min = state.day;
    const maxDate = new Date(timeR.now);
    maxDate.setDate(maxDate.getDate() + 28);
    dayInput.max = clinicDate(maxDate.toISOString());

    try {
      state.clinic = await get(`/api/public/clinics/${slug}`);
      clinicName.textContent = state.clinic.name;
      heroClinic.textContent = state.clinic.name;
      const quote = 'We treat every animal like it is somebody’s whole world — because it is.';
      const attribution = state.clinic.vets[0] ? `${state.clinic.vets[0].name}` : '';
      quoteBox.append(el('blockquote', { class: 'vets-quote', text: quote }));
      if (attribution) quoteBox.append(el('p', { style: 'color:#33424e', text: `— ${attribution}` }));
      for (const v of state.clinic.vets) {
        quoteBox.append(el('p', { style: 'color:#33424e;margin:2px 0', text: `${v.name}, small animal medicine` }));
      }
      for (const v of state.clinic.vets) {
        circles.append(el('span', {
          class: 'avatar',
          style: 'width:56px;height:56px;font-size:18px',
        }, v.name.split(/\s+/).map((w: string) => w[0]).slice(0, 2).join('')));
      }
    } catch {
      root.textContent = '';
      root.append(notFoundCard());
      return;
    }

    if (petToken) {
      try {
        state.pet = await get(`/api/public/clinics/${slug}/pets/${petToken}`);
        petBanner.append(el('p', { style: 'font-weight:700;color:#14212b', text: `Booking for ${state.pet.petName}` }));
        ownerName.value = state.pet.ownerName;
        ownerEmail.value = state.pet.ownerEmail;
        petName.value = state.pet.petName;
        speciesSel.value = state.pet.species;
      } catch {
        // an invalid or expired token shows the plain page
      }
    }

    await refreshSlots();
  })();
}

export function renderConfirmation(root: HTMLElement, slug: string, code: string): void {
  root.textContent = '';
  const main = el('main', { style: 'max-width:640px;margin:0 auto;padding:48px 24px' });
  const card = el('div', { class: 'tinted-card' });
  main.append(card);
  root.append(main);
  void (async () => {
    try {
      const b = await get(`/api/public/bookings/${code}`);
      card.append(el('h1', { class: 'screen-headline', style: 'font-size:32px', text: 'Your visit is booked' }));
      card.append(el('p', { style: 'font-size:18px;color:#14212b' }, `${b.petName} is booked with ${b.vetName} on ${clinicDayShort(b.start)} ${clinicDayMonth(b.start)} at ${clinicTime(b.start)}.`));
      card.append(el('p', { text: `A confirmation email is on its way to ${b.ownerEmail}.` }));
    } catch {
      root.textContent = '';
      root.append(notFoundCard());
    }
  })();
}

export function notFoundCard(): HTMLElement {
  const main = el('main', { style: 'max-width:640px;margin:0 auto;padding:48px 24px' });
  const card = el('div', { class: 'tinted-card' });
  card.append(el('h1', { class: 'screen-headline', style: 'font-size:32px', text: "We couldn't find that page." }));
  card.append(el('a', { class: 'pill pill-primary', href: '/today' }, 'Back to today'));
  main.append(card);
  return main;
}
