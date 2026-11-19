import { api, toast } from './app.js';

// The first page is in the document; this reads its cursor, then appends a page per press.
let cursor = null;
const button = document.getElementById('ladder-more');
const note = document.getElementById('ladder-note');

function cell(text) {
  const td = document.createElement('td');
  td.className = 'mono';
  td.textContent = text;
  return td;
}

function row(m) {
  const tr = document.createElement('tr');
  const member = document.createElement('td');
  member.className = 'ladder-member';
  const img = document.createElement('img');
  Object.assign(img, { className: 'avatar', src: m.avatar_url, alt: '', width: 24, height: 24 });
  const link = document.createElement('a');
  link.href = `/members/${encodeURIComponent(m.username)}`;
  link.textContent = m.username;
  member.append(img, link);
  tr.append(cell(m.rank), member, cell(m.rating_display), cell(m.games));
  return tr;
}

async function load(append) {
  button.disabled = true;
  try {
    const query = cursor ? `?limit=50&cursor=${encodeURIComponent(cursor)}` : '?limit=50';
    const data = await api(`/api/leaderboard${query}`);
    if (append) document.getElementById('ladder-body').append(...data.members.map(row));
    cursor = data.next_cursor;
  } catch (error) { toast(error.message, 'bad'); }
  button.disabled = false;
  button.hidden = !cursor;
  if (!cursor) note.textContent = 'That is the whole ladder.';
}

if (button) {
  load(false);
  button.addEventListener('click', () => load(true));
}
