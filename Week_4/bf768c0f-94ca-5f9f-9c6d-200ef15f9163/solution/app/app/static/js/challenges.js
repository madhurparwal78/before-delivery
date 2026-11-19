import { api, showFieldError, toast } from './app.js';

// Decline is the member's own dismissal: the brief's API table is the whole HTTP surface and lists no decline
// operation, so a declined challenge is hidden on this browser and stays open on the server.
const DECLINED = 'declined-challenges';
function declined() {
  try { return new Set(JSON.parse(localStorage.getItem(DECLINED) || '[]')); } catch { return new Set(); }
}
function remember(id) {
  const ids = declined(); ids.add(id);
  try { localStorage.setItem(DECLINED, JSON.stringify([...ids])); } catch { /* private mode: hidden until reload */ }
}

function key() {
  return (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
}

const EMPTY = {
  'received-list': 'No challenges yet. Challenge a member below.',
  'sent-list': 'No challenges yet. Send one below.',
  'settled-list': 'No challenges settled yet.',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(ch) {
  const who = ch.direction === 'received' ? ch.from : ch.to;
  const li = el('li', 'row-line spread challenge-row');
  li.dataset.challenge = ch.id;
  const left = el('span', 'row-line');
  const img = el('img', 'avatar');
  Object.assign(img, { src: who.avatar_url, alt: '', width: 28, height: 28 });
  const name = el('span');
  if (ch.direction === 'sent') name.append('To ');
  name.append(el('strong', '', who.username));
  left.append(img, name, el('span', 'chip', ch.rated ? 'rated' : 'casual'), el('span', 'chip', ch.colour));
  if (ch.club) left.append(el('span', 'chip', ch.club.name));
  left.append(el('span', ch.status === 'pending' ? 'chip warn' : 'chip', ch.status));
  const right = el('span', 'row-line');
  if (ch.status === 'pending' && ch.direction === 'received') {
    const accept = el('button', 'button small primary', 'Accept');
    accept.type = 'button';
    accept.dataset.accept = ch.id;
    const decline = el('button', 'button small', 'Decline');
    decline.type = 'button';
    decline.dataset.decline = ch.id;
    right.append(accept, decline);
  } else if (ch.game_id) {
    const open = el('a', 'button small', 'Open game');
    open.href = `/game/${ch.game_id}`;
    right.append(open);
  }
  li.append(left, right);
  return li;
}

function fill(id, items) {
  const list = document.getElementById(id);
  if (!list) return;
  list.replaceChildren(...(items.length ? items.map(row) : [el('li', 'empty', EMPTY[id])]));
}

let shown = '';
function render(rows) {
  const signature = rows.map((r) => `${r.id}:${r.status}`).join(',');
  if (signature === shown) return;
  shown = signature;
  const pending = rows.filter((r) => r.status === 'pending');
  const hidden = declined();
  fill('received-list', pending.filter((r) => r.direction === 'received' && !hidden.has(r.id)));
  fill('sent-list', pending.filter((r) => r.direction === 'sent'));
  fill('settled-list', rows.filter((r) => r.status !== 'pending').slice(0, 12));
}

async function refresh() {
  try { render(await api('/api/challenges')); } catch { /* the next poll tries again */ }
}

document.addEventListener('click', async (event) => {
  const accept = event.target.closest('[data-accept]');
  if (accept) {
    accept.disabled = true;
    try {
      const game = await api(`/api/challenges/${accept.dataset.accept}/accept`, {
        method: 'POST', headers: { 'Idempotency-Key': key() },
      });
      window.location.href = `/game/${game.id}`;
    } catch (error) {
      toast(error.message, 'bad');
      accept.disabled = false;
    }
    return;
  }
  const decline = event.target.closest('[data-decline]');
  if (decline) {
    remember(decline.dataset.decline);
    decline.closest('li')?.remove();
    shown = '';
    toast('Challenge declined.');
    await refresh();
  }
});

const challengeForm = document.getElementById('challenge-form');
if (challengeForm) {
  challengeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFieldError('challenge-error', '');
    const button = challengeForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const sent = await api('/api/challenges', {
        method: 'POST',
        body: {
          opponent: document.getElementById('opponent').value,
          colour: document.getElementById('challenge-colour').value,
          club: document.getElementById('challenge-club').value || null,
          rated: document.getElementById('challenge-rated').checked,
        },
      });
      toast(`Challenge sent to ${sent.to.username}.`, 'good');
      await refresh();
    } catch (error) { showFieldError('challenge-error', error.message); }
    button.disabled = false;
  });
}

// A new challenge, or an answer to one, arrives on this page without a reload.
refresh();
window.setInterval(refresh, 3000);
