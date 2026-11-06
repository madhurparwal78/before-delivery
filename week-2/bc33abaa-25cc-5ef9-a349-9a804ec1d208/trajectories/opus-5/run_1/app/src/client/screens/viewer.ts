import { PublishedPayload, ReviewPayload } from '../../shared/api';
import { Graph, REST_STATE_ID, transitionFor } from '../../shared/graph';
import { ApiCallError, api } from '../api';
import { el, mount } from '../dom';
import { reducedMotion } from '../motion';
import { Viewport, webglAvailable } from '../editor/viewport';

function stateListbox(
  graph: Graph,
  onChoose: (stateId: string) => void,
  selected: string,
): HTMLElement {
  const listbox = el('div', { role: 'listbox', 'aria-label': 'States', class: 'listbox' });
  mount(
    listbox,
    ...graph.states.map((state) => {
      const option = el('div', {
        role: 'option',
        'aria-selected': state.id === selected ? 'true' : 'false',
        tabindex: state.id === selected ? '0' : '-1',
        'data-state-id': state.id,
        text: state.name,
      });
      option.addEventListener('click', () => onChoose(state.id));
      option.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onChoose(state.id);
        }
      });
      return option;
    }),
  );
  return listbox;
}

export async function reviewScreen(root: HTMLElement, token: string): Promise<void> {
  let payload: ReviewPayload;
  try {
    payload = await api.get<ReviewPayload>(`/api/review/${encodeURIComponent(token)}`);
  } catch (error) {
    const expired = error instanceof ApiCallError && error.status === 410;
    mount(
      root,
      el('div', { class: 'review-page' }, [
        el('header', { class: 'review-header' }, [el('h1', { text: 'Review copy · read only' })]),
        el('p', {
          role: 'status',
          text: expired
            ? 'This review link has expired. Ask the editor for a new one.'
            : 'This review link is not valid.',
        }),
      ]),
    );
    return;
  }

  let stateId = REST_STATE_ID;
  const canvas = el('canvas', { class: 'viewport-canvas' });
  const region = el('div', {
    role: 'region',
    'aria-label': 'Viewport',
    class: 'viewport',
    tabindex: '0',
    'data-state': stateId,
  });
  const listboxHolder = el('div', { class: 'state-switcher' });

  let viewport: Viewport | null = null;
  const paintStates = (): void => {
    mount(
      listboxHolder,
      stateListbox(
        payload.graph,
        (next) => {
          stateId = next;
          region.dataset.state = next;
          viewport?.setState(next);
          paintStates();
        },
        stateId,
      ),
    );
  };
  paintStates();

  mount(
    root,
    el('div', { class: 'review-page' }, [
      el('header', { class: 'review-header' }, [
        el('h1', { text: payload.scene.name }),
        el('p', { class: 'figure', text: `v${payload.version.number}` }),
        el('p', { text: 'Review copy · read only' }),
      ]),
      el('div', { class: 'review-body' }, [region, listboxHolder]),
    ]),
  );
  mount(region, canvas);

  if (!webglAvailable()) {
    canvas.remove();
    region.append(
      el('p', {
        text: '3D preview needs WebGL. The hierarchy, inspector and operation log still work.',
      }),
      el('img', { src: `/api/review/${encodeURIComponent(token)}/thumbnail.png`, alt: payload.scene.name }),
    );
    return;
  }
  viewport = new Viewport({ canvas });
  viewport.setGraph(payload.graph, stateId);
  viewport.resize();
  window.addEventListener('resize', () => viewport?.resize());
}

export async function embedScreen(root: HTMLElement, embedId: string): Promise<void> {
  let payload: PublishedPayload;
  try {
    payload = await api.get<PublishedPayload>(`/api/embed/${encodeURIComponent(embedId)}`);
  } catch {
    mount(
      root,
      el('div', { class: 'embed-page' }, [
        el('p', { role: 'status', text: 'This scene is no longer available.' }),
      ]),
    );
    return;
  }

  const canvas = el('canvas', { class: 'viewport-canvas' });
  const region = el('div', {
    role: 'region',
    'aria-label': '3D scene',
    class: 'embed-scene',
    'data-state': REST_STATE_ID,
    'data-yaw': '0',
    tabindex: '0',
  });
  const scroller = el('div', { class: 'embed-scroller' });
  const stateSwitcher = el('div', { class: 'state-switcher' });
  let stateId = REST_STATE_ID;

  const hasMultipleStates = payload.graph.states.length > 1;
  const scrollTransition = transitionFor(payload.graph, REST_STATE_ID, 'scroll');

  mount(
    root,
    el('div', { class: 'embed-page' }, [
      region,
      hasMultipleStates ? stateSwitcher : null,
      scrollTransition ? scroller : null,
    ]),
  );
  mount(region, canvas);

  if (!webglAvailable()) {
    canvas.remove();
    region.append(
      el('p', { text: 'Interactive 3D needs WebGL.' }),
      el('img', { src: `/api/embed/${encodeURIComponent(embedId)}/thumbnail.png`, alt: payload.scene.name }),
    );
    return;
  }

  const viewport = new Viewport({
    canvas,
    onYaw: (yaw) => {
      region.dataset.yaw = yaw.toFixed(2);
    },
  });
  viewport.setGraph(payload.graph, REST_STATE_ID);
  viewport.resize();
  window.addEventListener('resize', () => viewport.resize());

  const paintStates = (): void => {
    if (!hasMultipleStates) return;
    mount(
      stateSwitcher,
      stateListbox(
        payload.graph,
        (next) => {
          stateId = next;
          region.dataset.state = next;
          viewport.setState(next);
          paintStates();
        },
        stateId,
      ),
    );
  };
  paintStates();

  function runTransition(trigger: 'hover' | 'click', reverse = false): void {
    const transition = transitionFor(payload.graph, REST_STATE_ID, trigger);
    if (!transition) return;
    const from = reverse ? transition.to : REST_STATE_ID;
    const to = reverse ? REST_STATE_ID : transition.to;
    region.dataset.state = to;
    stateId = to;
    if (reducedMotion() || transition.durationMs === 0) {
      viewport.setBlend(from, to, 1);
      return;
    }
    const start = performance.now();
    const frame = (now: number): void => {
      const progress = Math.min(1, (now - start) / transition.durationMs);
      viewport.setBlend(from, to, progress);
      if (progress < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  let hovering = false;
  let lastPointerAt = 0;
  const pointerOver = (): void => {
    lastPointerAt = performance.now();
    if (hovering) return;
    hovering = true;
    runTransition('hover');
  };
  region.addEventListener('pointermove', pointerOver);
  region.addEventListener('pointerdown', pointerOver);
  region.addEventListener('pointerleave', () => {
    lastPointerAt = performance.now();
    if (!hovering) return;
    hovering = false;
    runTransition('hover', true);
  });
  region.addEventListener('click', () => {
    runTransition('click');
  });

  if (scrollTransition) {
    document.body.classList.add('embed-scrolls');
    const onScroll = (): void => {
      const height = document.documentElement.scrollHeight - window.innerHeight;
      const progress = height <= 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / height));
      viewport.setBlend(REST_STATE_ID, scrollTransition.to, progress);
      region.dataset.state = progress < 0.5 ? REST_STATE_ID : scrollTransition.to;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  const turnSeconds = 30;
  let lastFrame = performance.now();
  const spin = (now: number): void => {
    const delta = (now - lastFrame) / 1000;
    lastFrame = now;
    const idle = now - lastPointerAt > 3_000;
    if (idle && !reducedMotion()) {
      viewport.setYaw((viewport.yawDegrees + (360 / turnSeconds) * delta) % 360);
    }
    requestAnimationFrame(spin);
  };
  requestAnimationFrame(spin);
}
