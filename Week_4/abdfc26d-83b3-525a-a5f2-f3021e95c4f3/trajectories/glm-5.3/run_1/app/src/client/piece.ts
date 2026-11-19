import { api, money, type OrderJson, type PieceJson } from './api.js';
import { startPieceCanvas } from './canvas.js';
import { announce, observeEntrances, watchHeaderScroll } from './motion.js';
import { EditionLens } from './lens.js';
import { CheckoutSheet } from './checkout.js';
import { headerRoleLinks, loadMe } from './header.js';

async function main(): Promise<void> {
  watchHeaderScroll(document.querySelector('header.studio-header'));
  const me = await loadMe();
  headerRoleLinks(me);

  const slug = window.location.pathname.split('/').pop() ?? '';
  const pieceResult = await api<PieceJson>('GET', `/api/pieces/${slug}`);
  if (!pieceResult.ok) {
    document.querySelector<HTMLElement>('[data-piece-error]')!.hidden = false;
    return;
  }
  const piece = pieceResult.body as PieceJson;

  const titleEl = document.querySelector<HTMLElement>('[data-piece-title]');
  const creatorEl = document.querySelector<HTMLElement>('[data-piece-creator]');
  const remixEl = document.querySelector<HTMLElement>('[data-piece-remix]');
  const priceEl = document.querySelector<HTMLElement>('[data-piece-price]');
  const leftEl = document.querySelector<HTMLElement>('[data-piece-left]');
  const hashEl = document.querySelector<HTMLElement>('[data-piece-hash]');
  const remixBtn = document.querySelector<HTMLButtonElement>('[data-remix-button]');
  if (titleEl) titleEl.textContent = piece.title;
  if (creatorEl) creatorEl.textContent = piece.creator.display_name;
  if (piece.remix_of && remixEl) {
    remixEl.hidden = false;
    remixEl.textContent = `Remix of ${piece.remix_of.title} by ${piece.remix_of.creator_display_name}`;
  }
  if (priceEl && piece.price_cents !== null) priceEl.textContent = `${money(piece.price_cents)} per edition`;
  if (leftEl && piece.edition_count !== null) leftEl.textContent = `${piece.editions_left ?? 0} of ${piece.edition_count} left`;

  const isOwner = me?.id === piece.creator.id;
  if (remixBtn) {
    remixBtn.hidden = !(me?.roles.includes('creator') ?? false) || isOwner;
    remixBtn.addEventListener('click', async () => {
      const result = await api<{ piece: PieceJson }>('POST', `/api/pieces/${slug}/remix`);
      if (result.ok) {
        const fresh = (result.body as { piece: PieceJson }).piece;
        announce(document.querySelector('[data-checkout-status]'), `Remix draft created from ${piece.title}.`);
        window.location.href = `/studio/pieces/${fresh.slug}`;
      }
    });
  }

  const canvasHost = document.querySelector<HTMLElement>('[data-piece-canvas]');
  if (canvasHost) startPieceCanvas(canvasHost, piece, {});

  const stage = document.querySelector<HTMLElement>('[data-edition-stage]');
  const statusRegion = document.querySelector<HTMLElement>('[data-checkout-status]');
  const dialog = document.querySelector<HTMLDialogElement>('dialog[data-checkout]');

  if (!stage || !dialog || piece.edition_count === null) return;

  const lens = new EditionLens(stage, piece, {
    onHoldGranted: (order) => {
      announce(statusRegion, `Edition ${order.edition} of ${order.edition_count} is held for you. ${mmssOf(order.seconds_left ?? 0)} left.`);
      sheet.open(order);
    },
    onHoldExpired: (n) => announce(statusRegion, `Your hold on edition ${n} expired.`),
    onTaken: (n, next) => {
      if (next !== null) announce(statusRegion, `Edition ${n} was just taken. Showing edition ${next}.`);
      else announce(statusRegion, `Every edition of this run is taken.`);
    },
    announce: (text) => announce(statusRegion, text)
  });
  lens.restoreFromUrl();

  const sheet = new CheckoutSheet({
    dialog,
    lens,
    piece,
    statusRegion,
    afterPaid: (order) => {
      void order;
    }
  });

  const seedFor = (n: number): void => {
    const info = lens.editionsList().find((e) => e.number === n);
    if (hashEl) hashEl.textContent = info?.seed_hash ?? '';
  };
  const initialInfo = lens.editionsList().find((e) => e.number === lens.current());
  if (hashEl && initialInfo) hashEl.textContent = initialInfo.seed_hash;

  const sheetDialog = dialog;
  // Refresh edition statuses every 5 seconds while the page is open.
  window.setInterval(() => {
    void lens.refresh().then(() => {
      seedFor(lens.current());
      void checkExistingHold();
    });
  }, 5000);

  async function checkExistingHold(): Promise<void> {
    const result = await api<OrderJson>('GET', `/api/orders/current?piece=${slug}`);
    if (!result.ok) return;
    const order = result.body as OrderJson;
    if (order.state === 'held') {
      lens.lockOnHold();
      if (!sheetDialog.open) sheet.reopenIfHeld(order);
      else sheet.refreshOrder(order);
    }
  }
  await checkExistingHold();

  // Keep the seed hash and details in step with the lens.
  const slider = stage.querySelector<HTMLInputElement>('input[type="range"]');
  slider?.addEventListener('input', () => seedFor(lens.current()));
  seedFor(lens.current());

  observeEntrances();
}

function mmssOf(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

void main();
