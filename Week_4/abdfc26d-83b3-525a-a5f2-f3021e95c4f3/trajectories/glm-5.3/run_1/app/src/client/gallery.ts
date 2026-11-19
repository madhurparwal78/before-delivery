import { api, type GalleryCard, type GalleryJson, type PieceJson } from './api.js';
import { startPieceCanvas } from './canvas.js';
import { observeEntrances, watchHeaderScroll } from './motion.js';
import { headerRoleLinks, loadMe } from './header.js';

interface SectionState { shown: number; expanded: boolean }

const SHOWN = { desktop: 6, tablet: 4, phone: 6 };

function shownCount(): number {
  const width = window.innerWidth;
  if (width < 768) return SHOWN.phone;
  if (width < 1280) return SHOWN.tablet;
  return SHOWN.desktop;
}

async function main(): Promise<void> {
  watchHeaderScroll(document.querySelector('header.studio-header'));
  const me = await loadMe();
  headerRoleLinks(me);

  const params = new URL(window.location.href).searchParams;
  const creator = params.get('creator');
  const result = await api<GalleryJson>('GET', `/api/gallery${creator ? `?creator=${encodeURIComponent(creator)}` : ''}`);
  if (!result.ok) return;
  const body = result.body as GalleryJson;

  const featuredHost = document.querySelector<HTMLElement>('[data-featured-run]');
  if (body.featured && featuredHost) {
    const piece = await api<PieceJson>('GET', `/api/pieces/${body.featured.slug}`);
    if (piece.ok) startPieceCanvas(featuredHost, piece.body as PieceJson, {});
    const titleEl = document.querySelector<HTMLElement>('[data-featured-title]');
    if (titleEl) titleEl.textContent = body.featured.title;
    featuredHost.parentElement?.setAttribute('href', `/pieces/${body.featured.slug}`);
  }

  const states = new Map<string, SectionState>();
  for (const section of body.sections) {
    const region = document.querySelector<HTMLElement>(`section[data-section="${section.id}"]`);
    if (!region) continue;
    const list = region.querySelector<HTMLElement>('[data-section-cards]')!;
    const cards = await Promise.all(section.pieces.map((card) => buildCard(card)));
    for (const card of cards) list.appendChild(card);
    const state = { shown: Math.min(shownCount(), section.pieces.length), expanded: false };
    states.set(section.id, state);
    paintSection(region, section, state);
    const empty = region.querySelector<HTMLElement>(`[data-empty-${section.id}]`);
    if (empty) empty.hidden = section.pieces.length > 0;
    const pill = region.querySelector<HTMLButtonElement>('[data-show-more]');
    if (pill) {
      pill.addEventListener('click', () => {
        const state = states.get(section.id)!;
        state.expanded = true;
        paintSection(region, section, state);
        const heading = region.querySelectorAll<HTMLElement>('[data-card-heading]')[state.shown];
        heading?.focus();
      });
    }
  }

  window.addEventListener('resize', () => {
    for (const section of body.sections) {
      const region = document.querySelector<HTMLElement>(`section[data-section="${section.id}"]`);
      const state = states.get(section.id);
      if (!region || !state || state.expanded) continue;
      state.shown = Math.min(shownCount(), section.pieces.length);
      paintSection(region, section, state);
    }
  });

  observeEntrances();
}

function paintSection(region: HTMLElement, section: { title: string; total: number; pieces: GalleryCard[] }, state: SectionState): void {
  const cards = Array.from(region.querySelectorAll<HTMLElement>('.piece-card'));
  cards.forEach((card, index) => {
    card.hidden = state.expanded ? false : index >= state.shown;
  });
  const wrap = region.querySelector<HTMLElement>('[data-show-more-wrap]');
  if (!wrap) return;
  const more = section.total - state.shown;
  if (!state.expanded && more > 0) {
    wrap.hidden = false;
    const pill = wrap.querySelector<HTMLButtonElement>('[data-show-more]');
    if (pill) pill.textContent = `Show all ${section.title}`;
    const counter = wrap.querySelector<HTMLElement>('[data-show-more-count]');
    if (counter) counter.textContent = `${state.shown} of ${section.total}`;
  } else {
    wrap.hidden = true;
  }
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
      <h3 data-card-heading tabindex="-1" style="outline:none">${escapeHtml(card.title)}</h3>
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
