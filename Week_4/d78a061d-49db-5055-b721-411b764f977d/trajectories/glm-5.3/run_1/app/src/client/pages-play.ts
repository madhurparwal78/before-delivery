import { el, t } from './ui.js';
import { api, getJson, type SessionSnapshot, type Party } from './api-client.js';
import { store, notify, loadMe } from './store.js';
import { languagePickerHtml } from './language.js';
import { signOutButton } from './pages-hangar.js';
import { hasWebGL, reducedMotion } from './scene.js';
import { emotes, stories } from '../shared/domain.js';
import { layout } from '../shared/domain.js';

/**
 * The play page (DP-31, DP-32, DP-34, DP-49, DP-53) and chapter complete (DP-34).
 */

export async function mountPlay(sessionId: string): Promise<void> {
  await loadMe();
  const root = document.getElementById('root');
  if (!root) return;
  const res = await getJson<{ session: SessionSnapshot }>(`/api/sessions/${sessionId}`);
  if (!res?.session) {
    location.href = '/stories';
    return;
  }
  const session = res.session;
  const story = stories.find((s) => s.id === session.story_id);
  document.title = `${story?.title ?? ''} · Linewright`;

  root.replaceChildren();
  const view = el('div', { class: 'game-view', role: 'application', 'aria-label': t('controls', 'game-view'), tabindex: '0' });
  const canvas = el('canvas', { class: 'game-canvas' }) as HTMLCanvasElement;
  view.append(canvas);
  const webgl = hasWebGL();
  view.setAttribute('data-renderer', webgl ? 'webgl' : 'still');
  view.setAttribute('data-flythrough', 'playing');
  if (!webgl) view.classList.add('still');

  const health = el('div', { class: 'hud health', role: 'meter', 'aria-label': t('controls', 'health'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '100' });
  const objective = el('div', { class: 'hud objective', role: 'status', 'aria-label': t('controls', 'objective') });
  const members = el('div', { class: 'hud session-members', role: 'list', 'aria-label': t('controls', 'session-members') });
  const eventsLog = el('div', { class: 'session-events', role: 'log', 'aria-label': t('controls', 'session-events') });
  const emoteButton = el('button', { class: 'ghost', text: t('controls', 'emotes') });
  const emoteMenu = el('div', { role: 'menu', 'aria-label': t('controls', 'emotes'), class: 'emote-menu', hidden: true });
  const chatBoxHolder = el('div', { class: 'session-chat-holder' });
  const skip = el('button', { class: 'ghost flythrough-skip', text: t('controls', 'skip') });

  let snapshot: SessionSnapshot = session;
  const myId = store.account?.id ?? '';
  const seenEventIds = new Set<string>();

  const render = () => {
    const me = snapshot.members.find((m) => m.account_id === myId);
    health.setAttribute('aria-valuenow', String(Math.round(me?.health ?? 100)));
    const collected = snapshot.motes.filter((m) => m.collected_by).length;
    objective.textContent = snapshot.gate_open ? t('copy', 'gate-open-objective') : t('copy', 'objective', { collected });
    members.replaceChildren();
    for (const member of snapshot.members) {
      const item = el('div', { class: 'session-member', role: 'listitem' });
      item.append(el('span', { text: member.display_name }));
      if (member.status === 'dropped') {
        item.append(el('span', { class: 'seat-held', text: t('copy', 'seat-held', { seconds: member.grace_remaining_seconds ?? 0 }) }));
      }
      members.append(item);
    }
    drawScene();
  };

  const drawScene = () => {
    const rect = view.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const worldToPx = (x: number, z: number) => ({
      px: rect.width / 2 + x * (rect.width / 46),
      py: rect.height / 2 + z * (rect.height / 46),
    });
    // puddle
    const puddle = worldToPx(layout.puddle.x, layout.puddle.z);
    ctx.fillStyle = 'rgba(36,33,32,0.25)';
    ctx.beginPath();
    ctx.arc(puddle.px, puddle.py, layout.puddle.radius * (rect.width / 46), 0, Math.PI * 2);
    ctx.fill();
    // checkpoint
    const checkpoint = worldToPx(layout.checkpoint.x, layout.checkpoint.z);
    ctx.strokeStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.arc(checkpoint.px, checkpoint.py, 14, 0, Math.PI * 2);
    ctx.stroke();
    // gate
    const gate = worldToPx(layout.gate.x, layout.gate.z);
    ctx.strokeStyle = snapshot.gate_open ? '#4d7c0f' : '#242120';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(gate.px - 18, gate.py - 10);
    ctx.lineTo(gate.px + 18, gate.py - 10);
    ctx.stroke();
    // motes
    for (const mote of snapshot.motes) {
      const point = worldToPx(mote.x, mote.z);
      ctx.fillStyle = mote.collected_by ? '#9a3412' : '#f5b301';
      ctx.beginPath();
      ctx.arc(point.px, point.py, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    // heroes as labelled dots
    for (const member of snapshot.members) {
      const point = worldToPx(member.position.x, member.position.z);
      ctx.fillStyle = member.status === 'dropped' ? '#8a8a8a' : '#1d4ed8';
      ctx.beginPath();
      ctx.arc(point.px, point.py, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#242120';
      ctx.font = '12px Nunito, sans-serif';
      ctx.fillText(member.display_name, point.px + 10, point.py + 4);
    }
  };

  // Flythrough: still for a moment under reduced motion, otherwise a short glide.
  const finishFlythrough = () => {
    view.setAttribute('data-flythrough', 'done');
    skip.hidden = true;
  };
  if (reducedMotion()) {
    view.setAttribute('data-flythrough', 'still');
    setTimeout(finishFlythrough, 900);
  } else {
    setTimeout(finishFlythrough, 3500);
  }
  skip.addEventListener('click', finishFlythrough);

  // Emotes (DP-53).
  const emoteNames: Record<string, string> = {
    wave: 'emote-wave', cheer: 'emote-cheer', bow: 'emote-bow', laugh: 'emote-laugh', point: 'emote-point', shrug: 'emote-shrug',
  };
  emoteButton.addEventListener('click', () => {
    emoteMenu.hidden = !emoteMenu.hidden;
    if (!emoteMenu.hidden) emoteMenu.querySelector<HTMLElement>('.emote-item')?.focus();
  });
  for (const emote of emotes) {
    const item = el('button', { class: 'emote-item', role: 'menuitem', text: t('controls', emoteNames[emote] ?? 'emote-wave') });
    item.addEventListener('click', () => {
      sendIntent('emote', { emote });
      emoteMenu.hidden = true;
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        (item.nextElementSibling as HTMLElement | null ?? emoteMenu.querySelector<HTMLElement>('.emote-item'))?.focus();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        (item.previousElementSibling as HTMLElement | null ?? emoteMenu.lastElementChild as HTMLElement)?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        emoteMenu.hidden = true;
        emoteButton.focus();
      }
    });
    emoteMenu.append(item);
  }

  const { queueIntent, followSession, onEvent, openRealtime } = await import('./realtime-client.js');
  let intentCounter = 0;
  const sendIntent = (action: 'move_to' | 'swing' | 'emote', params: Record<string, unknown> = {}) => {
    intentCounter += 1;
    const intentId = `intent-${Date.now()}-${intentCounter}`;
    queueIntent(intentId, sessionId, { type: 'intent', session_id: sessionId, intent_id: intentId, action, ...params });
  };

  view.addEventListener('click', (event) => {
    if (view.getAttribute('data-flythrough') !== 'done') return;
    const rect = view.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 46 - 23;
    const z = ((event.clientY - rect.top) / rect.height) * 46 - 23;
    sendIntent('move_to', { x, z });
  });

  const heldKeys = new Set<string>();
  let lastMoveAt = 0;
  document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (view.getAttribute('data-flythrough') !== 'done') {
      if (event.key === 'Escape' || event.key === 'Enter') finishFlythrough();
      return;
    }
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      heldKeys.add(key);
      const now = Date.now();
      if (now - lastMoveAt >= 250) {
        lastMoveAt = now;
        const me = snapshot.members.find((m) => m.account_id === myId);
        const dx = key === 'd' || key === 'arrowright' ? 2 : key === 'a' || key === 'arrowleft' ? -2 : 0;
        const dz = key === 's' || key === 'arrowdown' ? 2 : key === 'w' || key === 'arrowup' ? -2 : 0;
        sendIntent('move_to', { x: (me?.position.x ?? 0) + dx, z: (me?.position.z ?? 0) + dz });
      }
      event.preventDefault();
    } else if (key === ' ') {
      event.preventDefault();
      sendIntent('swing');
    } else if (key === 'e') {
      event.preventDefault();
      emoteMenu.hidden = !emoteMenu.hidden;
      if (!emoteMenu.hidden) emoteMenu.querySelector<HTMLElement>('.emote-item')?.focus();
    } else if (['1', '2', '3', '4', '5', '6'].includes(key)) {
      const emote = emotes[Number(key) - 1];
      if (emote) sendIntent('emote', { emote });
    }
  });
  document.addEventListener('keyup', (event) => {
    heldKeys.delete(event.key.toLowerCase());
  });
  void heldKeys;

  const appendEvent = (text: string) => {
    const line = el('div', { class: 'event-line', text });
    eventsLog.append(line);
  };

  followSession(sessionId);
  onEvent((message) => {
    if (message.type === 'snapshot' && message.session) {
      snapshot = message.session as SessionSnapshot;
      render();
      return;
    }
    if (message.type !== 'event' || !message.event) return;
    const event = message.event as { kind?: string; event_id?: string; [key: string]: unknown };
    const eventId = event.event_id ?? `${message.stream}-${message.seq}`;
    if (seenEventIds.has(eventId)) return;
    seenEventIds.add(eventId);
    if (event.kind === 'pickup') {
      appendEvent(t('copy', 'event-pickup', { name: String(event.name ?? ''), collected: Number(event.collected ?? 0) }));
    } else if (event.kind === 'emote') {
      const emote = String(event.emote ?? 'wave');
      appendEvent(t('copy', 'event-emote', { name: String(event.name ?? ''), emote: t('controls', emoteNames[emote] ?? 'emote-wave') }));
    } else if (event.kind === 'checkpoint') {
      appendEvent(t('copy', 'event-checkpoint'));
    } else if (event.kind === 'knocked_out') {
      appendEvent(t('copy', 'event-knocked-out', { name: String(event.name ?? '') }));
    } else if (event.kind === 'session_complete') {
      location.href = `/stories/${event.story_id}/chapters/${event.chapter}/complete`;
    }
  });

  openRealtime();
  render();

  const hudBox = el('div', { class: 'hud-box' });
  hudBox.append(health, objective);
  root.append(view, hudBox, members, eventsLog, emoteButton, emoteMenu, chatBoxHolder, skip, languagePickerHtml(), signOutButton());
}

export async function mountComplete(storyId: string, chapter: number): Promise<void> {
  await loadMe();
  const root = document.getElementById('root');
  if (!root) return;
  root.replaceChildren();
  const main = el('section', { class: 'page-main complete-main' });
  const heading = el('h1', { class: 'screen-heading', text: t('copy', 'chapter-complete-heading', { n: chapter }) });
  const progressRes = await getJson<{ progress: { completed_chapters: number[] } }>(`/api/stories/${storyId}/progress`).catch(() => null);
  const partyRes = await getJson<{ party: Party | null }>('/api/parties/current').catch(() => null);
  const isLeader = partyRes?.party?.leader_id === store.account?.id;
  const next = el('a', { class: 'primary-link', href: '/stories', text: t('controls', 'next-chapter') });
  const back = el('a', { class: 'secondary-link', href: '/stories', text: t('controls', 'back-to-stories') });
  const backLobby = el('a', { class: 'secondary-link', href: `/party/${partyRes?.party?.id ?? ''}`, text: t('controls', 'back-to-lobby'), hidden: !isLeader });
  main.append(heading, next, back, backLobby, languagePickerHtml(), signOutButton());
  root.append(main);
}
