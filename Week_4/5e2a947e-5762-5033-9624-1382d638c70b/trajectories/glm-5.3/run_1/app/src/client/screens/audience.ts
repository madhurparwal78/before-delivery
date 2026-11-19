import { el, openDialog, animate, reducedMotion } from '../lib/dom.js';
import { api, errorOf, toast } from '../lib/api.js';

/**
 * The audience screen: it needs no account, shows the server's
 * session state alone and swipes back to earlier slides on a phone.
 */

interface AudienceState {
  state: 'waiting' | 'live' | 'paused' | 'ended';
  slide_index: number;
  slide_count: number;
  presenter: string;
  followers: number;
  slide: { topic_id: string; topics: AudienceTopic[] } | null;
}

interface AudienceTopic {
  id: string; parent_id: string | null; rank: number; floating: boolean; x: number | null; y: number | null;
  title: string; colour: string | null; restricted: boolean; derived?: { colour: string };
}

export function renderAudience(root: HTMLElement, code: string): void {
  root.replaceChildren();
  const wrap = el('div', { class: 'audience' });
  const slideRegion = el('section', { class: 'slide-card', role: 'region', 'aria-label': 'Slide' });
  const canvas = el('div', { class: 'slide-canvas' });
  const stage = el('div', { class: 'stage', 'data-zoom': '1', 'data-pan-x': '0', 'data-pan-y': '0' });
  canvas.appendChild(stage);
  const status = el('p', { class: 'slide-status', role: 'status', 'aria-label': 'Presentation status' });
  const backToLive = el('button', { class: 'secondary', 'aria-label': 'Back to live', hidden: '' }, 'Back to live');
  slideRegion.append(canvas, status);
  wrap.append(slideRegion, backToLive);
  root.appendChild(wrap);

  let viewed = -1;

  const draw = (state: AudienceState) => {
    if (state.slide) {
      const topics = state.slide.topics;
      stage.replaceChildren();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
      for (const t of topics) {
        const isRoot = t.id === state.slide!.topic_id;
        const w = isRoot ? 240 : 180;
        const h = isRoot ? 48 : 32;
        const parentBox = t.parent_id ? boxes.get(t.parent_id) : null;
        const x = parentBox ? parentBox.x + parentBox.w / 2 + 80 + w / 2 : 0;
        const y = parentBox ? parentBox.y : 0;
        boxes.set(t.id, { x, y, w, h });
        minX = Math.min(minX, x - w / 2); minY = Math.min(minY, y - h / 2);
        maxX = Math.max(maxX, x + w / 2); maxY = Math.max(maxY, y + h / 2);
      }
      if (minX !== Infinity) {
        const cw = canvas.clientWidth || 640;
        const ch = canvas.clientHeight || 400;
        const zoom = Math.min(1, (cw - 96) / Math.max(1, maxX - minX), (ch - 96) / Math.max(1, maxY - minY));
        const panX = (cw / 2 - (minX + maxX) / 2 * zoom);
        const panY = (ch / 2 - (minY + maxY) / 2 * zoom);
        if (reducedMotion()) {
          stage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        } else {
          animate(stage, 'camera', [
            { transform: stage.style.transform || 'translate(0px, 0px) scale(1)' },
            { transform: `translate(${panX}px, ${panY}px) scale(${zoom})` },
          ], 400);
        }
        stage.setAttribute('data-zoom', zoom.toFixed(4));
        stage.setAttribute('data-pan-x', panX.toFixed(2));
        stage.setAttribute('data-pan-y', panY.toFixed(2));
        for (const [id, b] of boxes) {
          const t = topics.find((x) => x.id === id)!;
          const node = el('div', { class: 'topic', 'data-topic-id': id, 'data-x': String(b.x), 'data-y': String(b.y), 'data-w': String(b.w), 'data-h': String(b.h) }, t.title);
          node.style.left = `${b.x - b.w / 2}px`;
          node.style.top = `${b.y - b.h / 2}px`;
          node.style.width = `${b.w}px`;
          node.style.height = `${b.h}px`;
          stage.appendChild(node);
        }
      }
    }
    if (state.state === 'waiting') status.textContent = `The presentation hasn't started yet. It will appear here when ${state.presenter} goes live.`;
    else if (state.state === 'paused') status.textContent = 'The presenter has stepped away. The show will continue here.';
    else if (state.state === 'ended') status.textContent = 'This presentation has ended.';
    else status.textContent = `Slide ${state.slide_index + 1} of ${state.slide_count}`;
    backToLive.hidden = state.state === 'live' && viewed < 0;
  };

  const refresh = async () => {
    const out = await api<AudienceState>(`/api/presentations/by-code/${code}`);
    if (out.ok) draw(out.body as AudienceState);
  };
  void refresh();

  // Live follow over the audience socket.
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/api/presentations/by-code/${code}/live`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.type === 'presentation') {
      draw(msg.presentation as AudienceState);
    }
  };
  ws.onclose = () => { void refresh(); };

  backToLive.addEventListener('click', () => {
    viewed = -1;
    backToLive.hidden = true;
    void refresh();
  });

  // Audience swipes: right = back, left = forward, never past the live slide.
  let touchStartX: number | null = null;
  canvas.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
  canvas.addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(dx) < 50) return;
    if (dx > 0) viewed -= 1;
    else viewed += 1;
    void refresh();
  });
  void errorOf;
  void toast;
  void openDialog;
}
