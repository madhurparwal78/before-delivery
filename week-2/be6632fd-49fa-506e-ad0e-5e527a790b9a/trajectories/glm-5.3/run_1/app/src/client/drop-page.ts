// The public drop page: night section, market availability, look carousel, story,
// the Claim a piece form and the Join the waitlist form.
import { apiOk, api, failOf, MARKETS, type PublicDrop } from './api.js';
import { el, buttonEl, liveRegion, announce, statusMark, clearFieldErrors, showProblems, fieldError } from './ui.js';
import { marketTimeWords, parseInstant, countdown, money } from './format.js';
export function renderWithdrawn(root: HTMLElement): HTMLElement {
  root.append(el('a', { class: 'skip-link', href: '#main', text: 'Skip to content' }));
  const h = el('h1', {}, 'This drop was withdrawn');
  const panel = el('div', { class: 'panel' });
  panel.append(statusMark('withdrawn'), el('p', { text: 'This drop was withdrawn.' }));
  panel.append(el('a', { href: '/', text: 'Back to the drop calendar' }));
  root.append(h, panel);
  return h;
}

export async function renderDropPage(root: HTMLElement, drop: PublicDrop, slug: string): Promise<HTMLElement> {
  root.append(el('a', { class: 'skip-link', href: '#main', text: 'Skip to content' }));
  const night = el('section', { class: 'night-section', 'aria-labelledby': 'drop-title' });
  const h = el('h1', { id: 'drop-title' }, drop.name);
  night.append(el('p', { class: 'brand-line', text: drop.brand }), h, statusMark(drop.status));

  // Market availability table.
  const avail = el('table', {});
  avail.append(el('caption', { text: 'Market availability' }));
  const thead = el('thead', {}, el('tr', {}, el('th', { text: 'Market' }), el('th', { text: 'Opens' }), el('th', { text: 'Status' }), el('th', { text: 'Pieces left', class: 'num' })));
  const tbody = el('tbody');
  function refreshAvail(): void {
    tbody.replaceChildren();
    for (const m of drop.markets) {
      const opens = m.goLiveAt ? marketTimeWords(parseInstant(m.goLiveAt), m.market, m.city) : '—';
      const status = el('td', {});
      status.append(statusMark(m.status));
      tbody.append(el('tr', {}, el('td', { text: m.city }), el('td', { class: 'mono', text: opens }), status, el('td', { class: 'num mono', text: String(m.piecesLeft ?? 0) })));
    }
  }
  refreshAvail();
  avail.append(thead, tbody);
  night.append(avail);
  root.append(night);

  // Look carousel.
  if (drop.looks.length > 0) {
    const region = el('section', { class: 'carousel', role: 'region', 'aria-label': 'Look carousel' });
    const track = el('div', { class: 'track' });
    let index = 0;
    const slides = drop.looks.map(look => el('div', { class: 'slide' }, el('img', { src: look.imageUrl, alt: look.altText })));
    slides.forEach(s => track.append(s));
    const position = liveRegion('Look position');
    const setIndex = (i: number): void => {
      index = Math.max(0, Math.min(drop.looks.length - 1, i));
      slides.forEach((s, k) => { s.style.transform = `translateX(${-100 * index}%)`; });
      position.textContent = `${index + 1} / ${drop.looks.length}`;
    };
    const prev = buttonEl({ class: 'btn', text: 'Previous look', 'aria-label': 'Previous look', onclick: () => setIndex(index - 1) });
    const next = buttonEl({ class: 'btn', text: 'Next look', 'aria-label': 'Next look', onclick: () => setIndex(index + 1) });
    region.append(track, prev, next, position);
    setIndex(0);
    // Swipe by touch on the track.
    let startX = 0;
    track.addEventListener('touchstart', (e: TouchEvent) => { startX = e.touches[0].clientX; }, { passive: true });
    track.addEventListener('touchend', (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) setIndex(index + (dx < 0 ? 1 : -1));
    }, { passive: true });
    root.append(el('section', { class: 'panel' }, region));
  }

  // Published story.
  if (drop.storyHtml) {
    const story = el('article', { class: 'panel story-body', 'aria-label': 'Story' });
    story.innerHTML = drop.storyHtml;
    root.append(story);
  }

  // Claim a piece form.
  const liveMarkets = drop.markets.filter(m => m.status === 'live' && (m.piecesLeft ?? 0) > 0);
  if (liveMarkets.length > 0) {
    const claimForm = el('form', { 'aria-label': 'Claim a piece', onsubmit: async (e: Event) => {
      e.preventDefault();
      clearFieldErrors(claimForm);
      const body = {
        market: marketSel.value,
        name: (claimForm.querySelector('[name="name"]') as HTMLInputElement).value,
        email: (claimForm.querySelector('[name="email"]') as HTMLInputElement).value
      };
      const key = `claim-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setPending(claimBtn, 'Claiming…');
      try {
        const res = await api<{ claim: { reference: string }; piecesLeft: number }>('POST', `/api/public/drops/${slug}/claims`, body, { headers: { 'Idempotency-Key': key } });
        announce(claimStatus, `Claimed. Your reference is ${res.data!.claim.reference}.`);
        const market = drop.markets.find(m => m.market === body.market);
        if (market) market.piecesLeft = res.data!.piecesLeft;
        refreshAvail();
      } catch (err) {
        const fail = failOf(err);
        if (fail.status === 429) announce(claimStatus, `Too many sign-ups from this connection. Try again in ${fail.retryAfterSeconds ?? 1} seconds.`, true);
        else if (fail.claimedAt) announce(claimStatus, `Sorry — the last piece went to another shopper at ${marketTimeWords(parseInstant(fail.claimedAt), 'copenhagen', 'Copenhagen')}.`, true);
        else announce(claimStatus, fail.message, true);
        if (fail.fields) {
          showProblems(claimForm, fail, { market: 'Market', name: 'Name', email: 'Email' });
          for (const [p, msg] of Object.entries(fail.fields)) fieldError(claimForm, p, msg, p);
        }
      } finally {
        setPending(claimBtn, null);
      }
    } });
    const marketSel = el('select', { 'aria-label': 'Market', name: 'market' }) as HTMLSelectElement;
    for (const m of liveMarkets) marketSel.append(el('option', { value: m.market, text: m.city }));
    const claimBtn = buttonEl({ class: 'btn btn-primary', type: 'submit', text: 'Claim a piece' });
    const claimStatus = liveRegion('Claim status');
    claimForm.append(
      marketSelectWrap(claimForm, marketSel),
      inputWrap(claimForm, 'Name', 'name'),
      inputWrap(claimForm, 'Email', 'email'),
      claimBtn,
      claimStatus
    );
    root.append(el('section', { class: 'panel' }, el('h2', {}, 'Claim a piece'), claimForm));
    }

  // Join the waitlist form with a sticky phone bar.
  const waitForm = el('form', { 'aria-label': 'Join the waitlist', onsubmit: async (e: Event) => {
    e.preventDefault();
    clearFieldErrors(waitForm);
    const body = {
      market: wlMarket.value,
      name: (waitForm.querySelector('[name="wl-name"]') as HTMLInputElement).value,
      email: (waitForm.querySelector('[name="wl-email"]') as HTMLInputElement).value,
      consent: (waitForm.querySelector('[name="consent"]') as HTMLInputElement).checked
    };
    setPending(joinBtn, 'Joining…');
    try {
      await apiOk('POST', `/api/public/drops/${slug}/waitlist`, body);
      announce(waitStatus, 'Check your inbox. If this address can join, a confirmation link is on its way.');
    } catch (err) {
      const fail = failOf(err);
      if (fail.status === 429) announce(waitStatus, `Too many sign-ups from this connection. Try again in ${fail.retryAfterSeconds ?? 1} seconds.`, true);
      else announce(waitStatus, fail.message, true);
      if (fail.fields) {
        showProblems(waitForm, fail, { market: 'Market', name: 'Name', email: 'Email', consent: 'Consent' });
        for (const [p, msg] of Object.entries(fail.fields)) fieldError(waitForm, p === 'name' ? 'wl-name' : p === 'email' ? 'wl-email' : p, msg, p);
      }
    } finally {
      setPending(joinBtn, null);
    }
  } });
  const wlMarket = el('select', { 'aria-label': 'Market', name: 'wl-market' }) as HTMLSelectElement;
  for (const m of MARKETS) wlMarket.append(el('option', { value: m.market, text: m.city, ...(m.market === 'copenhagen' ? { selected: true } : {}) }));
  const joinBtn = buttonEl({ class: 'btn btn-primary', type: 'submit', text: 'Join waitlist' });
  const waitStatus = liveRegion('Waitlist status');
  const consent = el('input', { type: 'checkbox', name: 'consent' }) as HTMLInputElement;
  const consentLabel = el('label', { class: 'check' }, consent, el('span', { text: 'I agree to receive drop emails' }));
  waitForm.append(
    marketSelectWrap(waitForm, wlMarket, 'wl-market'),
    inputWrap(waitForm, 'Name', 'wl-name'),
    inputWrap(waitForm, 'Email', 'wl-email'),
    consentLabel,
    joinBtn,
    waitStatus
  );
  const waitPanel = el('section', { class: 'panel' }, el('h2', {}, 'Join the waitlist'), waitForm);
  root.append(waitPanel);

  // Sticky phone bar with the Join waitlist action.
  const stickyBar = el('div', { class: 'sticky-bar' });
  const barJoin = buttonEl({ class: 'btn btn-primary', text: 'Join waitlist', onclick: () => { waitPanel.scrollIntoView({ behavior: 'smooth', block: 'center' }); joinBtn.focus(); } });
  stickyBar.append(barJoin);
  root.append(stickyBar);

  // Market availability refreshes every 5 seconds.
  const timer = setInterval(async () => {
    if (!document.contains(avail)) { clearInterval(timer); return; }
    try {
      const fresh = await apiOk<PublicDrop>('GET', `/api/public/drops/${slug}`);
      if (fresh) {
        drop.markets = fresh.markets;
        refreshAvail();
      }
    } catch { /* keep the last known values */ }
  }, 5000);

  void money;
  return h;
}

function setPending(btn: HTMLButtonElement, copy: string | null): void {
  if (copy === null) { btn.disabled = false; btn.textContent = btn.dataset.pendingOf ?? btn.textContent ?? ''; delete btn.dataset.pendingOf; return; }
  btn.dataset.pendingOf = btn.textContent ?? '';
  btn.textContent = copy;
  btn.disabled = true;
}

function marketSelectWrap(form: HTMLElement, sel: HTMLSelectElement, name?: string): HTMLElement {
  const wrap = el('label', { class: 'field' });
  wrap.append(el('span', { class: 'label', text: 'Market' }), sel);
  sel.name = name ?? sel.name ?? 'market';
  void form;
  return wrap;
}

function inputWrap(form: HTMLElement, label: string, name: string, type = 'text'): HTMLElement {
  const wrap = el('label', { class: 'field' });
  const input = el('input', { type, name, 'aria-label': label });
  input.removeAttribute('required');
  wrap.append(el('span', { class: 'label', text: label }), input);
  void form;
  return wrap;
}
