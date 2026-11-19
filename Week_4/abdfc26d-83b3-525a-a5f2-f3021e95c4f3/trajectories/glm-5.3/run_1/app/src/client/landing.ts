import { api, type GalleryJson, type PieceJson } from './api.js';
import { startPieceCanvas } from './canvas.js';
import { PixelPanel, observeEntrances, startTypewriter, startVerbStack, watchHeaderScroll } from './motion.js';
import { headerRoleLinks, loadMe } from './header.js';
import type { GalleryCard } from './api.js';

const PROMPT_EXAMPLE = 'Oil-slick ripples that thicken toward the bottom edge, slow tide, warm rim light';

async function main(): Promise<void> {
  watchHeaderScroll(document.querySelector('header.studio-header'));
  const me = await loadMe();
  headerRoleLinks(me);

  const gallery = await api<GalleryJson>('GET', '/api/gallery');
  const body = gallery.body as GalleryJson;
  const featured = body.featured;
  const heroHost = document.querySelector<HTMLElement>('[data-hero-canvas]');

  if (featured && heroHost) {
    const piece = await api<PieceJson>('GET', `/api/pieces/${featured.slug}`);
    const pieceBody = piece.body as PieceJson;
    startPieceCanvas(heroHost, pieceBody, {});
    const strip = document.querySelector<HTMLElement>('[data-featured-strip]');
    if (strip) {
      strip.querySelector<HTMLElement>('[data-strip-title]')!.textContent = featured.title;
      strip.querySelector<HTMLElement>('[data-strip-creator]')!.textContent = featured.creator_display_name;
      strip.querySelector<HTMLElement>('[data-strip-left]')!.textContent = `${featured.editions_left} editions left`;
      strip.querySelector<HTMLAnchorElement>('[data-strip-remix]')!.href = `/pieces/${featured.slug}`;
    }
    const numeral = document.querySelector<HTMLElement>('.hero-numeral');
    const caption = document.querySelector<HTMLElement>('.hero-caption');
    if (numeral) numeral.textContent = '14';
    if (caption && featured.edition_count !== null) caption.textContent = `of ${featured.edition_count} · move to choose`;
    const heroNumeralLink = document.querySelector<HTMLElement>('[data-hero-link]');
    if (heroNumeralLink) heroNumeralLink.setAttribute('href', `/pieces/${featured.slug}`);
  }

  startVerbStack(document.querySelector('[data-verb-stack]'));
  startTypewriter(document.querySelector<HTMLInputElement>('[data-prompt-input]'), PROMPT_EXAMPLE);

  const panel = document.querySelector<HTMLImageElement>('[data-pixel-panel]');
  const pixelPanel = panel ? new PixelPanel(panel) : null;
  const statusLine = document.querySelector<HTMLElement>('[data-describe-status]');

  const form = document.querySelector<HTMLFormElement>('form[data-describe-form]');
  const input = document.querySelector<HTMLInputElement>('[data-prompt-input]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const prompt = (input?.value ?? '').trim();
    const fieldError = document.querySelector<HTMLElement>('[data-prompt-error]');
    if (prompt.length < 3 || prompt.length > 500) {
      if (fieldError) fieldError.textContent = `Describe the piece in 3 to 500 characters.`;
      return;
    }
    if (fieldError) fieldError.textContent = '';
    if (!me) {
      window.location.href = `/auth/login?return_to=${encodeURIComponent(`/?prompt=${encodeURIComponent(prompt)}`)}`;
      return;
    }
    if (!me.roles.includes('creator')) {
      if (statusLine) statusLine.textContent = `Only creator accounts can start pieces.`;
      return;
    }
    pixelPanel?.setState('drafting');
    if (statusLine) statusLine.textContent = `Drafting your piece...`;
    const result = await api<{ piece: PieceJson }>('POST', '/api/pieces/describe', { prompt });
    if (result.status === 503 || result.status === 502) {
      pixelPanel?.setState('error');
      if (statusLine) statusLine.textContent = result.status === 503
        ? `The shader assistant is offline. Your prompt is kept; try again in a minute.`
        : `The shader assistant sent something we can't run. Try a different prompt.`;
      if (input) input.value = prompt;
      return;
    }
    if (result.status === 403) {
      pixelPanel?.setState('idle');
      if (statusLine) statusLine.textContent = `Only creator accounts can start pieces.`;
      return;
    }
    if (!result.ok) {
      pixelPanel?.setState('idle');
      return;
    }
    const created = (result.body as { piece: PieceJson }).piece;
    if (statusLine) statusLine.textContent = `Draft ready. Tune it on the instrument panel.`;
    window.location.href = `/studio/pieces/${created.slug}`;
  });

  // Keep the prompt across sign-in.
  const params = new URL(window.location.href).searchParams;
  const kept = params.get('prompt');
  if (kept && input) input.value = kept;

  // Gallery cards in section 01.
  const runs = body.sections.find((section) => section.id === 'runs');
  const cardRow = document.querySelector<HTMLElement>('[data-landing-cards]');
  if (cardRow) {
    for (const card of (runs?.pieces ?? []).slice(0, 3)) {
      cardRow.appendChild(await buildCard(card));
    }
  }
  observeEntrances();
}

async function buildCard(card: GalleryCard): Promise<HTMLElement> {
  const anchor = document.createElement('a');
  anchor.className = 'piece-card rise';
  anchor.href = `/pieces/${card.slug}`;
  anchor.innerHTML = `
    <div class="card-canvas" data-card-canvas></div>
    <div class="scrim"></div>
    <span class="tag-chip ${card.remix_of ? 'remix' : ''}">${card.remix_of ? 'Remix' : 'GLSL'}</span>
    <div class="card-copy">
      <h3>${escapeHtml(card.title)}</h3>
      <div class="caption">${escapeHtml(card.creator_display_name)} · ${card.editions_left} of ${card.edition_count} left</div>
    </div>`;
  const piece = await api<PieceJson>('GET', `/api/pieces/${card.slug}`);
  if (piece.ok) startPieceCanvas(anchor.querySelector<HTMLElement>('[data-card-canvas]')!, piece.body as PieceJson, {});
  return anchor;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

void main();
