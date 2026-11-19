import { api, money, type PieceJson } from './api.js';
import { observeEntrances, watchHeaderScroll } from './motion.js';
import { headerRoleLinks, loadMe } from './header.js';

async function main(): Promise<void> {
  watchHeaderScroll(document.querySelector('header.studio-header'));
  const me = await loadMe();
  headerRoleLinks(me);
  if (!me) {
    window.location.href = '/auth/login?return_to=/studio';
    return;
  }

  const creditsResult = await api<{ available: number; held: number }>('GET', '/api/me/credits');
  if (creditsResult.ok) {
    const credits = creditsResult.body as { available: number; held: number };
    const avail = document.querySelector<HTMLElement>('[data-credits-available]');
    const held = document.querySelector<HTMLElement>('[data-credits-held]');
    if (avail) avail.textContent = `${credits.available} available`;
    if (held) held.textContent = `${credits.held} reserved`;
  }
  const planResult = await api<{ plan: { code: string; state: string; ends_on: string | null } | null }>('GET', '/api/me/plan');
  const planEl = document.querySelector<HTMLElement>('[data-plan-line]');
  if (planResult.ok) {
    const plan = (planResult.body as { plan: { code: string; state: string; ends_on: string | null } | null }).plan;
    if (planEl) {
      planEl.textContent = plan
        ? (plan.state === 'cancelling' && plan.ends_on ? `Your plan ends on ${plan.ends_on}.` : `Your ${plan.code === 'studio-monthly' ? 'Studio' : 'Pro'} plan is ${plan.state}.`)
        : `No plan yet.`;
    }
  }

  const piecesResult = await api<{ pieces: PieceJson[] }>('GET', '/api/studio-pieces');
  const list = document.querySelector<HTMLElement>('[data-studio-rows]');
  const empty = document.querySelector<HTMLElement>('[data-studio-empty]');
  if (!piecesResult.ok || !list) return;
  const pieces = (piecesResult.body as { pieces: PieceJson[] }).pieces;
  if (empty) empty.hidden = pieces.length > 0;
  for (const piece of pieces) {
    const row = document.createElement('tr');
    const sold = piece.edition_count !== null ? piece.edition_count - (piece.editions_left ?? 0) : 0;
    row.innerHTML = `
      <td data-label="Title"><a href="/studio/pieces/${piece.slug}" class="display-face">${escapeHtml(piece.title)}</a></td>
      <td data-label="State">${piece.state}</td>
      <td data-label="Version" class="tnum">${piece.version}</td>
      <td data-label="Editions sold" class="tnum">${sold}</td>
      <td data-label="Price" class="money tnum">${piece.price_cents !== null ? money(piece.price_cents) : '—'}</td>`;
    list.appendChild(row);
  }
  observeEntrances();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

void main();
