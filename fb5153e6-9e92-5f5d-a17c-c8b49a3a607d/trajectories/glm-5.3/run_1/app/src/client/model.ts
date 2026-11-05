import { api, copy, escapeHtml, announce, wireCore, ApiFailure } from './app-core.js';
import { SurveyViewer, viewerNumber } from './viewer.js';

interface CheckoutResult {
  order: string;
  receipt_url: string;
  licence: string;
  amount_cents: number;
  currency: string;
  edition_number: number | null;
}

function amountOf(cents: number): string {
  const l = document.documentElement.lang === 'de' ? 'de' : 'en';
  const whole = Math.floor(cents / 100).toLocaleString(l === 'en' ? 'en-US' : 'de-DE');
  const part = String(cents % 100).padStart(2, '0');
  return l === 'en' ? `€${whole}.${part}` : `${whole},${part} €`;
}

/** The checkout dialog: one Idempotency-Key per dialog, focus trap, Enter to pay. */
function openCheckout(model: string, licence: string, priceCents: number, upgradeFrom?: string, accessToken?: string): void {
  const idemKey = `ui-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  const dialog = document.createElement('div');
  dialog.className = 'dialog-underlay';
  dialog.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
  <h2 id="checkout-title">${copy('checkout.title')}</h2>
  <p>${escapeHtml(licenceLabel(licence))} · <span class="mono">${amountOf(priceCents)}</span></p>
  <label for="checkout-email">${copy('checkout.email')}</label>
  <input type="email" id="checkout-email" autocomplete="email">
  <label class="checkbox-row"><input type="checkbox" id="checkout-terms"> ${copy('checkout.terms')}</label>
  <button type="button" id="checkout-pay">${copy('checkout.pay_now')}</button>
  <button type="button" id="checkout-cancel">${copy('checkout.cancel')}</button>
  <p class="visually-hidden" role="status" id="checkout-status" aria-live="polite"></p>
  <p class="form-alert" role="alert" id="checkout-alert" hidden></p>
</div>`;
  document.body.appendChild(dialog);
  const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('input, button'));
  const first = focusables[0];
  first?.focus();
  const close = (): void => {
    dialog.remove();
    document.body.classList.remove('modal-open');
  };
  document.body.classList.add('modal-open');
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const active = document.activeElement;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (event.shiftKey && (active === firstEl || active === dialog)) {
        event.preventDefault();
        lastEl?.focus();
      } else if (!event.shiftKey && (active === lastEl || active === dialog)) {
        event.preventDefault();
        firstEl?.focus();
      }
    }
  });
  (dialog.querySelector('#checkout-cancel') as HTMLButtonElement).addEventListener('click', close);
  const status = dialog.querySelector<HTMLElement>('#checkout-status');
  const alert = dialog.querySelector<HTMLElement>('#checkout-alert');
  const pay = dialog.querySelector<HTMLButtonElement>('#checkout-pay');
  const submit = (): void => {
    const email = (dialog.querySelector('#checkout-email') as HTMLInputElement).value;
    const terms = (dialog.querySelector('#checkout-terms') as HTMLInputElement).checked;
    if (alert !== null && alert !== undefined) alert.hidden = true;
    if (pay !== null) pay.disabled = true;
    announce(status, copy('checkout.pending'));
    const locale = document.documentElement.lang === 'de' ? 'de' : 'en';
    void api<CheckoutResult>('/api/checkout', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey },
      body: JSON.stringify({
        model,
        licence,
        email,
        terms,
        locale,
        ...(accessToken === undefined ? {} : { access: accessToken }),
        ...(upgradeFrom === undefined ? {} : { upgrade_from: upgradeFrom }),
      }),
    })
      .then(result => {
        window.location.href = result.receipt_url + (locale === 'de' ? '?lang=de' : locale === 'en' ? '?lang=en' : '');
      })
      .catch(err => {
        if (pay !== null) pay.disabled = false;
        announce(status, '');
        const failure = err instanceof ApiFailure ? err : null;
        if (failure !== null && failure.fields['email'] !== undefined) {
          if (alert !== null) {
            alert.innerHTML = `<p>${escapeHtml(copy('error.summary_title'))}</p><ul><li><a href="#checkout-email">${escapeHtml(failure.fields['email'])}</a></li></ul>`;
            alert.hidden = false;
          }
          return;
        }
        if (failure !== null && failure.fields['terms'] !== undefined) {
          if (alert !== null) {
            alert.innerHTML = `<p>${escapeHtml(copy('error.summary_title'))}</p><ul><li><a href="#checkout-terms">${escapeHtml(failure.fields['terms'])}</a></li></ul>`;
            alert.hidden = false;
          }
          return;
        }
        const message = failure !== null ? (copy(failure.code) === failure.code ? failure.message : copy(failure.code)) : copy('billing_unavailable');
        if (alert !== null && alert !== undefined) {
          alert.textContent = message;
          alert.hidden = false;
        }
      });
  };
  pay?.addEventListener('click', submit);
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Enter' && document.activeElement !== dialog.querySelector('#checkout-cancel')) {
      event.preventDefault();
      submit();
    }
  });
}

function licenceLabel(licence: string): string {
  if (licence === 'personal') return copy('licence.personal');
  if (licence === 'commercial') return copy('licence.commercial');
  if (licence === 'studio') return copy('licence.studio');
  return copy('licence.edition');
}

function wireBuyButtons(): void {
  const shareMatch = /^\/u\/([A-Za-z0-9_-]+)$/.exec(window.location.pathname);
  const accessToken = shareMatch === null ? undefined : (shareMatch[1] ?? undefined);
  document.querySelectorAll<HTMLButtonElement>('.buy-button').forEach(button => {
    button.addEventListener('click', () => {
      const model = button.closest<HTMLElement>('.model-page')?.dataset['slug'] ?? document.getElementById('viewer-root')?.dataset['slug'] ?? '';
      const licence = button.dataset['licence'] ?? 'personal';
      const priceText = button.closest('tr')?.querySelector('.mono')?.textContent ?? '0';
      const priceCents = parseAmount(priceText);
      openCheckout(model, licence, priceCents, undefined, accessToken);
    });
  });
}

function parseAmount(text: string): number {
  const match = /(\d+(?:[.,]\d{1,2})?)/.exec(text);
  if (match === null) return 0;
  const raw = match[1] ?? '0';
  if (raw.includes(',')) {
    const [whole, part = '0'] = raw.split(',');
    return Number(whole) * 100 + Number((part + '00').slice(0, 2));
  }
  if (raw.includes('.')) {
    const [whole, part = '0'] = raw.split('.');
    return Number(whole) * 100 + Number((part + '00').slice(0, 2));
  }
  return Number(raw) * 100;
}

/** Edition availability: refresh at least once a second, disable buy at zero. */
function wireEditionPolling(): void {
  const status = document.getElementById('edition-availability');
  const model = document.getElementById('viewer-root')?.dataset['slug'];
  if (status === null || model === undefined) return;
  const buyButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.buy-button[data-licence="edition"]'));
  window.setInterval(() => {
    void api<{ total: number; remaining: number; on_sale: boolean }>(`/api/models/${model}/edition`)
      .then(result => {
        status.textContent =
          result.remaining <= 0
            ? copy('model.sold_out')
            : copy('model.edition_left', { remaining: result.remaining, total: result.total });
        const soldOut = result.remaining <= 0 || !result.on_sale;
        for (const button of buyButtons) {
          button.disabled = soldOut;
        }
      })
      .catch(() => undefined);
  }, 1000);
}

function wirePasswordGate(): void {
  const form = document.getElementById('unlock-form') as HTMLFormElement | null;
  const alert = form?.querySelector<HTMLElement>('.gate-alert');
  if (form === null) return;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const slug = form.dataset['slug'] ?? '';
    const password = (form.querySelector('#model-password') as HTMLInputElement).value;
    void api(`/api/models/${slug}/unlock`, { method: 'POST', body: JSON.stringify({ password }) })
      .then(() => {
        window.location.reload();
      })
      .catch(err => {
        const failure = err instanceof ApiFailure ? err : null;
        const message = failure !== null && failure.code === 'wrong_password' ? copy('wrong_password') : copy('not_found');
        if (alert !== null && alert !== undefined) {
          alert.textContent = message;
          alert.hidden = false;
        }
      });
  });
}

function wireViewer(): void {
  const root = document.getElementById('viewer-root');
  if (root === null) return;
  const viewer = new SurveyViewer(root as HTMLElement);
  const hotspotsJson = root.dataset['hotspots'];
  if (hotspotsJson !== undefined && hotspotsJson !== '') {
    viewer.setHotspots(safeParseHotspots(hotspotsJson));
  }
  void viewer.init();
}

function wireStudioViewerControls(): void {
  const root = document.getElementById('viewer-root');
  const saveView = document.getElementById('save-default-view');
  if (root === null || saveView === null) return;
  const viewer = new SurveyViewer(root as HTMLElement);
  const hotspots = (root.dataset['hotspots'] ?? '[]') !== '' ? safeParseHotspots(root.dataset['hotspots'] ?? '[]') : [];
  viewer.setHotspots(hotspots);
  void viewer.init();
  const save = (): void => {
    const camera = viewer.cameraState();
    const distanceFactor = camera.distanceFactor;
    void api(`/api/studio/models/${root.dataset['slug']}/view`, {
      method: 'PUT',
      body: JSON.stringify({
        default_camera: {
          azimuth: camera.azimuth,
          tilt: camera.tilt,
          distance: distanceFactor,
          fov: camera.fov,
        },
        hotspots: viewer.hotspotsState(),
      }),
    })
      .then(() => announce(document.getElementById('studio-notices'), copy('studio.saved')))
      .catch(err => {
        const failure = err instanceof ApiFailure ? err : null;
        if (failure !== null && failure.fields['hotspots'] !== undefined) {
          announce(document.getElementById('studio-notices'), copy('field.hotspots'));
        } else if (failure !== null && failure.fields['camera'] !== undefined) {
          announce(document.getElementById('studio-notices'), copy('field.camera'));
        }
      });
  };
  saveView.addEventListener('click', save);
  const addHotspot = document.getElementById('add-hotspot');
  const label = document.getElementById('hotspot-label') as HTMLInputElement | null;
  const saveHotspots = document.getElementById('save-hotspots');
  addHotspot?.addEventListener('click', () => {
    viewer.beginPlace(point => {
      const text = label?.value ?? '';
      const next = viewer.hotspotsState();
      next.push({ label: text === '' ? 'Hotspot' : text, x_mm: round1(point.x_mm), y_mm: round1(point.y_mm), z_mm: round1(point.z_mm) });
      viewer.setHotspots(next);
      label?.focus();
      announce(document.getElementById('viewer-announcements'), copy('studio_model.add_hotspot'));
    });
  });
  saveHotspots?.addEventListener('click', save);
}

function safeParseHotspots(raw: string): { label: string; x_mm: number; y_mm: number; z_mm: number }[] {
  try {
    const parsed = JSON.parse(raw) as { label: string; x_mm: number; y_mm: number; z_mm: number }[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

wireCore();
wireViewer();
wireBuyButtons();
wireEditionPolling();
wirePasswordGate();
wireStudioViewerControls();
