import { copy } from '../../shared/copy.js';
import { boundingBox, layoutMap } from '../../shared/layout.js';
import { emptyDoc, newTopic } from '../../shared/ops.js';
import { colourHex, derivedColour } from '../../shared/style.js';
import { visibleTopics } from '../../shared/tree.js';
import type { ApiTopic, MapDoc } from '../../shared/types.js';
import { api } from '../api.js';
import { animate, clear, el, on, reducedMotion } from '../dom.js';
import { resetScreen } from '../shell.js';

interface AudienceState {
  state: 'waiting' | 'live' | 'paused' | 'ended';
  slide_index: number;
  slide_count: number;
  presenter: string;
  followers: number;
  slide: { topic_id: string; topics: ApiTopic[] } | null;
}

function docFromSlide(slide: { topic_id: string; topics: ApiTopic[] }): MapDoc {
  const doc = emptyDoc(slide.topic_id, slide.topics[0]?.title ?? '');
  doc.topics = {};
  for (const topic of slide.topics) {
    const stored = newTopic(topic.id, topic.parent_id, topic.title);
    stored.colour = topic.colour;
    stored.icon = topic.icon;
    doc.topics[topic.id] = stored;
  }
  for (const topic of [...slide.topics].sort((a, b) => a.rank - b.rank)) {
    if (topic.parent_id !== null && doc.topics[topic.parent_id]) {
      doc.topics[topic.parent_id].children.push(topic.id);
    }
  }
  doc.root = slide.topic_id;
  if (!doc.topics[doc.root]) doc.topics[doc.root] = newTopic(doc.root, null, '');
  doc.topics[doc.root].parent_id = null;
  return doc;
}

export async function audienceScreen(params: Record<string, string>): Promise<void> {
  const root = resetScreen();
  document.title = 'Presentation';
  const status = el('p', {
    class: 'presentation-status',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Presentation status',
  });
  const stage = el('div', { class: 'stage audience-stage' });
  const canvas = el('div', { class: 'audience-canvas' }, [stage]);
  const card = el('div', { class: 'slide-card', role: 'region', 'aria-label': 'Slide' }, [
    canvas,
    status,
  ]);
  const backToLive = el('button', { type: 'button', class: 'secondary', text: 'Back to live' });
  backToLive.hidden = true;
  root.append(el('main', { class: 'audience' }, [card, backToLive]));

  let latest: AudienceState | null = null;
  let shown: AudienceState | null = null;
  let viewedIndex: number | null = null;
  const history = new Map<number, { topic_id: string; topics: ApiTopic[] }>();

  const paint = (): void => {
    const state = shown;
    if (!state) return;
    const texts: Record<AudienceState['state'], string> = {
      waiting: copy.audienceWaiting(state.presenter),
      live: copy.slideCounter(state.slide_index + 1, Math.max(state.slide_count, 1)),
      paused: copy.audiencePaused,
      ended: copy.audienceEnded,
    };
    status.textContent = texts[state.state];
    clear(stage);
    if (state.state !== 'live' || !state.slide) return;
    const doc = docFromSlide(state.slide);
    const view = { doc, collapsed: new Set<string>(), hidden: new Set<string>() };
    const layout = layoutMap(view, 'map');
    const bounds = boundingBox(layout) ?? { x: 0, y: 0, w: 1, h: 1 };
    const rect = canvas.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : 640;
    const height = rect.height > 0 ? rect.height : 360;
    const zoom =
      Math.round(
        Math.min(1, (width - 96) / Math.max(bounds.w, 1), (height - 96) / Math.max(bounds.h, 1)) *
          10000,
      ) / 10000;
    const panX = width / 2 - (bounds.x + bounds.w / 2) * zoom;
    const panY = height / 2 - (bounds.y + bounds.h / 2) * zoom;
    const from = {
      zoom: Number(stage.dataset.zoom ?? zoom),
      panX: Number(stage.dataset.panX ?? panX),
      panY: Number(stage.dataset.panY ?? panY),
    };
    stage.dataset.zoom = zoom.toFixed(4);
    stage.dataset.panX = panX.toFixed(2);
    stage.dataset.panY = panY.toFixed(2);
    stage.style.transform = `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${zoom})`;
    if (!reducedMotion()) {
      animate(
        stage,
        'camera',
        [
          {
            transform: `translate(${from.panX.toFixed(2)}px, ${from.panY.toFixed(2)}px) scale(${from.zoom})`,
          },
          {
            transform: `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${zoom})`,
          },
        ],
        400,
      );
    }
    for (const id of visibleTopics(view)) {
      const laid = layout.get(id);
      const topic = doc.topics[id];
      if (!laid || !topic) continue;
      const node = el('div', { class: 'topic' }, [el('span', { text: topic.title })]);
      node.dataset.topicId = id;
      node.dataset.x = String(laid.x);
      node.dataset.y = String(laid.y);
      node.dataset.w = String(laid.w);
      node.dataset.h = String(laid.h);
      node.style.left = `${laid.x - laid.w / 2}px`;
      node.style.top = `${laid.y - laid.h / 2}px`;
      node.style.width = `${laid.w}px`;
      node.style.minHeight = `${laid.h}px`;
      node.style.setProperty('--branch', colourHex(derivedColour(doc, id)));
      stage.append(node);
    }
    const colour = colourHex(derivedColour(doc, doc.root));
    card.style.borderColor = colour;
  };

  const take = (state: AudienceState): void => {
    latest = state;
    if (state.slide) history.set(state.slide_index, state.slide);
    if (viewedIndex === null || viewedIndex === state.slide_index) {
      viewedIndex = null;
      shown = state;
      backToLive.hidden = true;
    }
    paint();
  };

  on(backToLive, 'click', () => {
    viewedIndex = null;
    shown = latest;
    backToLive.hidden = true;
    paint();
  });

  let touchStart: number | null = null;
  on(card, 'touchstart', (event) => {
    touchStart = (event as TouchEvent).touches[0]?.clientX ?? null;
  });
  on(card, 'touchend', (event) => {
    if (touchStart === null || latest === null) return;
    const end = (event as TouchEvent).changedTouches[0]?.clientX ?? touchStart;
    const delta = end - touchStart;
    touchStart = null;
    if (Math.abs(delta) < 50) return;
    const current = viewedIndex ?? latest.slide_index;
    const next = delta > 0 ? current - 1 : current + 1;
    if (next < 0 || next > latest.slide_index) return;
    if (next === latest.slide_index) {
      viewedIndex = null;
      shown = latest;
      backToLive.hidden = true;
    } else {
      viewedIndex = next;
      const slide = history.get(next) ?? null;
      shown = { ...latest, slide_index: next, slide };
      backToLive.hidden = false;
    }
    paint();
  });

  const first = await api.get<AudienceState>(`/api/presentations/by-code/${params.code}`).catch(() => null);
  if (first === null) {
    clear(root);
    root.append(el('main', { class: 'message-page' }, [el('h1', { text: copy.unknownPage })]));
    return;
  }
  take(first);
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(
    `${protocol}://${window.location.host}/api/presentations/by-code/${params.code}/live`,
  );
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as AudienceState & { type: string };
    if (message.type !== 'presentation') return;
    take(message);
  });
}
