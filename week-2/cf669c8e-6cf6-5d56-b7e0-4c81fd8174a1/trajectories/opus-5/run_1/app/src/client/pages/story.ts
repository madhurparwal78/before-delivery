/**
 * The teardown story.
 *
 * The page holds the scene pinned while scrolling through the story. Part
 * offsets are a pure function of progress, so they rise monotonically going
 * down and fall step by step going up, with every offset back to exactly 0 at
 * progress 0 and the pixels following the same function.
 *
 * Under reduced motion the story is not pinned: it shows its six stages as
 * stacked stills in normal flow, each with its caption and the offsets those
 * parts have at the end of that stage.
 */

import { el, onReducedMotionChange, prefersReducedMotion, setAttrIfChanged } from '../dom.js';
import { buildParts, storyOffset, storyStageFor, STORY_STAGE_COUNT } from '../scene/geometry.js';
import { SceneView } from '../scene/view.js';
import { store } from '../state.js';
import type { Page, PageContext, PageFactory } from '../main.js';

/** How much scrolling the pinned story takes, as multiples of the viewport. */
const SCROLL_SPAN = 4;

export const storyPage: PageFactory = (context: PageContext): Page => {
  let view: SceneView | null = null;
  let detach: (() => void) | null = null;
  let stopReduced: (() => void) | null = null;

  return {
    async mount(container) {
      const catalogue = await store.loadCatalogue();
      const parts = buildParts({
        catalogue,
        model: catalogue.donors[0]?.model ?? 'K50',
        packId: catalogue.packs[1]?.id ?? 'P-1500',
        hubId: catalogue.hubs[0]?.id ?? 'H-1000',
      });
      const captions = catalogue.storyCaptions;

      const region = el('section', {
        class: 'story',
        role: 'region',
        'aria-label': 'Teardown story',
        'data-story-progress': '0.000',
        'data-story-stage': '1',
      });

      const intro = el('div', { class: 'story-intro' }, [
        el('h1', { class: 'heading-1' }, ['Prove the kit fits, in millimetres']),
        el('p', { class: 'lede' }, [
          'Swap a working 50cc petrol scooter for electric drive. We measure your own frame before you leave a deposit.',
        ]),
      ]);

      const start = el('a', { class: 'primary', href: '/configure' }, ['Configure your kit']);
      start.addEventListener('click', (event) => {
        event.preventDefault();
        context.navigate('/configure');
      });

      const render = (): void => {
        while (region.firstChild) region.firstChild.remove();
        if (view) {
          view = null;
        }

        if (prefersReducedMotion()) {
          mountStacked(region, parts, captions);
          setAttrIfChanged(region, 'data-story-progress', '1.000');
          setAttrIfChanged(region, 'data-story-stage', String(STORY_STAGE_COUNT));
          detach?.();
          detach = null;
          return;
        }
        mountPinned(region, parts, captions);
      };

      const mountPinned = (host: HTMLElement, sceneParts: ReturnType<typeof buildParts>, texts: readonly string[]): void => {
        const scene = new SceneView(
          {
            onPartClick: () => undefined,
            onTravel: () => undefined,
            onStop: () => undefined,
            onCameraChange: () => publish(),
          },
          'story',
        );
        view = scene;
        scene.setParts(sceneParts);

        const caption = el('p', { class: 'story-caption' }, [texts[0] ?? '']);
        const pin = el('div', { class: 'story-pin' }, [
          el('div', { class: 'story-stage' }, [scene.element, caption]),
        ]);
        const track = el('div', { class: 'story-track' }, [pin]);
        track.style.height = `${(SCROLL_SPAN + 1) * 100}vh`;
        host.append(track);

        const publish = (): void => {
          setAttrIfChanged(scene.element, 'data-azimuth-deg', scene.camera3.azimuthDeg.toFixed(0));
          setAttrIfChanged(scene.element, 'data-elevation-deg', scene.camera3.elevationDeg.toFixed(0));
          setAttrIfChanged(scene.element, 'data-zoom', scene.camera3.zoom.toFixed(2));
          setAttrIfChanged(scene.element, 'data-story-offsets', JSON.stringify(scene.storyOffsets()));
        };

        const onScroll = (): void => {
          const box = track.getBoundingClientRect();
          const travelled = Math.min(Math.max(-box.top, 0), box.height - window.innerHeight);
          const span = Math.max(1, box.height - window.innerHeight);
          const progress = Math.min(1, Math.max(0, travelled / span));

          scene.setStoryProgress(progress);
          const stage = storyStageFor(progress);
          setAttrIfChanged(region, 'data-story-progress', progress.toFixed(3));
          setAttrIfChanged(region, 'data-story-stage', String(stage));
          caption.textContent = texts[stage - 1] ?? '';
          publish();
        };

        const onResize = (): void => {
          scene.resize();
          onScroll();
        };

        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onResize);
        detach = () => {
          window.removeEventListener('scroll', onScroll);
          window.removeEventListener('resize', onResize);
        };

        requestAnimationFrame(() => {
          scene.resize();
          onScroll();
        });
      };

      container.append(intro, el('p', {}, [start]), region);
      render();

      stopReduced = onReducedMotionChange(() => render());
    },

    unmount() {
      detach?.();
      stopReduced?.();
    },
  };
};

/**
 * The reduced-motion stack: six stills, each carrying the offsets those parts
 * have at the end of that stage, so parts of that stage and earlier sit at
 * full story distance and later parts at `0.0`.
 */
function mountStacked(
  host: HTMLElement,
  parts: ReturnType<typeof buildParts>,
  captions: readonly string[],
): void {
  for (let stage = 1; stage <= STORY_STAGE_COUNT; stage += 1) {
    const progress = stage / STORY_STAGE_COUNT;
    const offsets: Record<string, [string, string, string]> = {};
    for (const part of parts) {
      if (part.storyStage === null) continue;
      const offset = storyOffset(part, progress);
      offsets[part.id] = [offset[0].toFixed(1), offset[1].toFixed(1), offset[2].toFixed(1)];
    }

    const still = new SceneView(
      {
        onPartClick: () => undefined,
        onTravel: () => undefined,
        onStop: () => undefined,
        onCameraChange: () => undefined,
      },
      'story',
    );
    still.setParts(parts);
    still.setStoryProgress(progress);
    setAttrIfChanged(still.element, 'data-story-stage', String(stage));
    setAttrIfChanged(still.element, 'data-story-offsets', JSON.stringify(offsets));
    setAttrIfChanged(still.element, 'data-azimuth-deg', still.camera3.azimuthDeg.toFixed(0));
    setAttrIfChanged(still.element, 'data-elevation-deg', still.camera3.elevationDeg.toFixed(0));
    setAttrIfChanged(still.element, 'data-zoom', still.camera3.zoom.toFixed(2));

    host.append(
      el('div', { class: 'story-stage story-stage--stacked' }, [
        still.element,
        el('p', { class: 'story-caption' }, [captions[stage - 1] ?? '']),
      ]),
    );
    requestAnimationFrame(() => still.resize());
  }
}
