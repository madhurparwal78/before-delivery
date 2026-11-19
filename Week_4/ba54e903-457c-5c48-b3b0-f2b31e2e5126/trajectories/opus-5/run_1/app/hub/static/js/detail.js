// The community detail page: joining, and the control each caller should see.

import { api, encodeNext, token } from './api.js';

const area = document.getElementById('join-area');
const button = document.getElementById('join-community');
const slug = area.dataset.slug;

async function join() {
  const answer = await api('/api/servers/' + slug + '/join', { method: 'POST' });
  if (!answer.ok) return;
  window.sessionStorage.setItem('hub_joined_slug', slug);
  window.location.replace(
    `/channels/${answer.data.community_id}/${answer.data.default_channel_id}`
  );
}

async function draw() {
  if (!token()) return;
  const answer = await api('/api/servers/' + slug);
  if (!answer.ok || !answer.data.me) return;
  const link = document.createElement('a');
  link.href = '/servers/' + slug;
  link.id = 'open-community';
  link.textContent = 'Open community';
  const channel = answer.data.channels.find((entry) => entry.type === 'text');
  if (channel) link.href = `/channels/${answer.data.id}/${channel.id}`;
  area.replaceChildren(link);
}

button.addEventListener('click', () => {
  if (!token()) {
    const next = `/servers/${slug}?join=1`;
    window.location.href = '/register?next=' + encodeNext(next);
    return;
  }
  join();
});

window.addEventListener('pageshow', () => {
  if (area.dataset.join !== '1') draw();
});

if (area.dataset.join === '1' && token()) join();
else draw();
