// The claim page (hold countdown by the server's clock, sticky Claim bar), the
// waitlist opt-in page and the press preview page with its dead-link states.
import { api, apiOk, failOf } from './api.js';
import { el, buttonEl, liveRegion, announce } from './ui.js';
import { route, navigate } from './router.js';
import { countdown, marketTimeWords, parseInstant } from './format.js';

interface HoldOut { dropSlug: string; dropName: string; market: string; city: string; status: string; offeredAt: string; expiresAt: string; }

export function registerClaimRoutes(): void {
  route('/claim/:holdToken', (root, p) => renderClaim(root, p.holdToken));
  route('/waitlist/confirm/:token', (root, p) => renderOptIn(root, p.token));
  route('/press/:token', (root, p) => renderPress(root, p.token));
}

async function renderClaim(root: HTMLElement, holdToken: string): Promise<HTMLElement> {
  root.append(el('a', { class: 'skip-link', href: '#main', text: 'Skip to content' }));
  const h = el('h1', {}, 'Your held piece');
  let hold: HoldOut | null = null;
  try { hold = await apiOk<HoldOut>('GET', `/api/public/holds/${holdToken}`); } catch { hold = null; }
  const status = liveRegion('Claim status');
  const info = el('p', {});
  const timerText = el('p', { class: 'mono', style: 'font-size: 2rem;' });
  if (!hold) {
    info.textContent = 'This hold link is no longer valid.';
    root.append(h, info);
    return h;
  }
  info.append(`${hold.dropName} — ${hold.city}`);
  const link = el('a', { href: `/drops/${hold.dropSlug}`, text: hold.dropName });
  root.append(h, link, info, timerText, status);

  const claimBtn = buttonEl({ class: 'btn btn-primary', text: 'Claim piece', onclick: async () => {
    claimBtn.disabled = true;
    claimBtn.textContent = 'Claiming…';
    try {
      const key = `hold-${holdToken}`;
      const res = await api<{ claim: { reference: string }; piecesLeft: number }>('POST', `/api/public/drops/${hold!.dropSlug}/claims`, { holdToken }, { headers: { 'Idempotency-Key': key } });
      announce(status, `Claimed. Your reference is ${res.data!.claim.reference}.`);
      claimBtn.hidden = true;
    } catch (err) {
      const fail = failOf(err);
      claimBtn.disabled = false;
      claimBtn.textContent = 'Claim piece';
      if (fail.status === 409 && fail.code === 'hold_expired') {
        announce(status, `This hold ended. The piece has gone back to the drop.`, true);
      } else if (fail.status === 409 && fail.claimedAt) {
        const t = marketTimeWords(parseInstant(fail.claimedAt), 'copenhagen', 'Copenhagen');
        announce(status, `Sorry — the last piece went to another shopper at ${t}.`, true);
      } else if (fail.status === 409 && fail.code === 'hold_claimed') {
        announce(status, 'This piece is already claimed.', true);
      } else {
        announce(status, fail.message, true);
      }
    }
  } });

  const timerRole = el('p', { role: 'timer', 'aria-label': 'Hold ends in' });
  timerRole.append(timerText);
  root.append(timerRole, claimBtn);
  const stickyBar = el('div', { class: 'sticky-bar' });
  const barClaim = buttonEl({ class: 'btn btn-primary', text: 'Claim piece', onclick: () => claimBtn.click() });
  stickyBar.append(barClaim);
  root.append(stickyBar);

  // The hold counts down by the server's clock, re-checking the hold every 5 s.
  let serverNow = new Date();
  async function tick(showEnd: boolean): Promise<void> {
    let fresh: HoldOut | null = hold;
    try {
      const res = await api<HoldOut>('GET', `/api/public/holds/${holdToken}`);
      serverNow = res.date;
      fresh = res.data;
      hold = fresh;
    } catch { /* keep last */ }
    if (!fresh) return;
    const remain = new Date(fresh.expiresAt).getTime() - serverNow.getTime();
    timerText.textContent = countdown(remain);
    if (fresh.status !== 'offered' && showEnd) {
      const ended = marketTimeWords(parseInstant(fresh.expiresAt), fresh.market, fresh.city);
      announce(status, `This hold ended at ${ended}. The piece has gone back to the drop.`, true);
      claimBtn.disabled = true;
    }
  }
  await tick(false);
  const timer = setInterval(() => { void tick(true); }, 5000);
  new MutationObserver(() => { if (!document.contains(h)) clearInterval(timer); }).observe(document.body, { childList: true, subtree: true });
  return h;
}

async function renderOptIn(root: HTMLElement, token: string): Promise<HTMLElement> {
  root.append(el('a', { class: 'skip-link', href: '#main', text: 'Skip to content' }));
  const h = el('h1', {}, 'Waitlist confirmation');
  const status = liveRegion('Waitlist status');
  let info: { dropName: string; market: string } | null = null;
  try { info = await apiOk<{ dropName: string; market: string }>('POST', '/api/public/waitlist/confirm', { token }); } catch (err) {
    const fail = failOf(err);
    if (fail.code === 'link_used') status.textContent = 'This link was already used. Your place is kept.';
    else if (fail.code === 'link_expired') status.textContent = 'This link has expired. Join the waitlist again for a new one.';
    else status.textContent = fail.message;
    root.append(h, status);
    return h;
  }
  const cities: Record<string, string> = { copenhagen: 'Copenhagen', stockholm: 'Stockholm', paris: 'Paris', london: 'London', new_york: 'New York', tokyo: 'Tokyo' };
  root.append(h, el('p', { text: `${info!.dropName} — ${cities[info!.market] ?? info!.market}` }));
  const confirmBtn = buttonEl({ class: 'btn btn-primary', text: 'Confirm my place', onclick: async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Confirming…';
    try {
      const res = await api<{ dropName: string; market: string }>('POST', '/api/public/waitlist/confirm', { token });
      announce(status, `You're on the waitlist for ${res.data!.dropName} in ${cities[res.data!.market] ?? res.data!.market}.`);
      confirmBtn.hidden = true;
    } catch (err) {
      const fail = failOf(err);
      if (fail.code === 'link_used') announce(status, 'This link was already used. Your place is kept.');
      else if (fail.code === 'link_expired') announce(status, 'This link has expired. Join the waitlist again for a new one.');
      else announce(status, fail.message, true);
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm my place';
    }
  } });
  root.append(confirmBtn, status);
  return h;
}

interface PressPayload {
  brand: string; dropName: string; type: string; embargoUntil: string | null; expiresAt: string;
  markets: { market: string; city: string; goLiveAt: string | null }[];
  storyHtml: string | null;
  looks: { id: string; position: number; title: string; altText: string; imageUrl: string; width: number; height: number }[];
}

const DEAD_COPY: Record<string, string> = {
  link_revoked: 'This preview link was revoked by the press team.',
  link_expired: 'This preview link has expired.',
  link_replaced: 'This preview link was replaced by a newer one. Check your inbox.',
  drop_withdrawn: 'This drop was withdrawn, so its preview is closed.'
};

async function renderPress(root: HTMLElement, token: string): Promise<HTMLElement> {
  root.append(el('a', { class: 'skip-link', href: '#main', text: 'Skip to content' }));
  let payload: PressPayload | null = null;
  let deadCode: string | null = null;
  try { payload = await apiOk<PressPayload>('GET', `/api/press/${token}`); } catch (err) {
    const fail = failOf(err);
    deadCode = fail.code;
  }
  if (!payload) {
    const h = el('h1', {}, 'This preview is no longer available');
    root.append(h, el('p', { text: DEAD_COPY[deadCode ?? 'link_expired'] ?? DEAD_COPY.link_expired }));
    return h;
  }
  const h = el('h1', {}, `Press preview: ${payload.dropName}`);
  const downloadStatus = liveRegion('Download status');
  const embargoLine = payload.embargoUntil ? marketTimeWords(parseInstant(payload.embargoUntil), 'copenhagen', 'Copenhagen') : '—';
  root.append(el('section', { class: 'night-section' },
    el('p', { text: payload.brand }), h,
    el('p', { class: 'mono', text: `Embargoed until ${embargoLine}` })));
  const openTimes = el('ul', {});
  for (const m of payload.markets) {
    const t = m.goLiveAt ? marketTimeWords(parseInstant(m.goLiveAt), m.market, m.city) : '—';
    openTimes.append(el('li', { class: 'mono', text: `${m.city}: ${t}` }));
  }
  root.append(el('section', { class: 'panel' }, el('h2', {}, 'Market opening times'), openTimes));
  if (payload.storyHtml) {
    const story = el('article', { class: 'panel story-body', 'aria-label': 'Story' });
    story.innerHTML = payload.storyHtml;
    root.append(story);
  }
  const looksList = el('ul', { 'aria-label': 'Looks', class: 'look-grid' });
  for (const look of payload.looks) {
    looksList.append(el('li', { class: 'look-card' }, el('img', { src: look.imageUrl, alt: look.altText }), el('p', { text: look.title })));
  }
  root.append(el('section', { class: 'panel' }, looksList));
  const downloadBtn = buttonEl({ class: 'btn btn-primary', text: 'Download images', onclick: async () => {
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Preparing download…';
    try {
      const res = await fetch(`/api/press/${token}/zip`);
      if (!res.ok) {
        announce(downloadStatus, 'Downloads are unavailable right now. Try again shortly.', true);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${payload!.dropName.replace(/\s+/g, '-').toLowerCase()}-press.zip`;
      a.click();
      URL.revokeObjectURL(url);
      announce(downloadStatus, 'Download ready.');
    } catch {
      announce(downloadStatus, 'Downloads are unavailable right now. Try again shortly.', true);
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = 'Download images';
    }
  } });
  const stickyBar = el('div', { class: 'sticky-bar' });
  stickyBar.append(downloadBtn);
  root.append(stickyBar, downloadStatus);

  // An open press page follows its link's state, re-checking at least every 5 s.
  const timer = setInterval(async () => {
    if (!document.contains(h)) { clearInterval(timer); return; }
    try {
      await apiOk<PressPayload>('GET', `/api/press/${token}`);
    } catch (err) {
      clearInterval(timer);
      const fail = failOf(err);
      const copy = DEAD_COPY[fail.code] ?? DEAD_COPY.link_expired;
      const deadH = el('h1', {}, 'This preview is no longer available');
      const app = document.getElementById('app');
      const main = app?.querySelector('main');
      if (main) {
        main.replaceChildren();
        main.append(deadH, el('p', { text: copy }));
        deadH.setAttribute('tabindex', '-1');
        deadH.focus();
      }
    }
  }, 5000);
  void navigate;
  return h;
}
