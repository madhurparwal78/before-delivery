import { LAYERS, LAYER_LABELS, type Layer } from '../../shared/projectStatus.ts';
import { el } from '../shared/dom.ts';

export type StationData = {
  slug: string;
  title: string;
  credit_label: string;
  credit_line: string;
  role: string;
  blurb: string;
  thresholds: Record<Layer, number>;
  playable: boolean;
  stems: Array<{ id: string; layer: Layer; url: string }>;
};

export type CameraState = 'wide' | 'moving' | 'close';

export type StationView = {
  data: StationData;
  chapter: HTMLElement;
  region: HTMLElement;
  heading: HTMLHeadingElement;
  ladder: HTMLElement;
  slider: HTMLInputElement | null;
  setIntensity: (intensity: number) => void;
  setActiveLayers: (active: readonly Layer[]) => void;
  setCamera: (state: CameraState) => void;
};

export function createStationView(
  data: StationData,
  index: number,
  options: { reducedMotion: boolean; onRung: (layer: Layer) => void; onSlider: (intensity: number) => void },
): StationView {
  const headingId = `station-${index}-title`;
  const heading = el('h2', { class: 'station-title', id: headingId, tabindex: -1, text: data.title });

  const textBlock = el('div', { class: 'station-text' }, [
    el('p', { class: 'credit-label', text: data.credit_label }),
    heading,
    el('p', { class: 'station-role', text: data.role }),
    el('p', { class: 'station-credit', text: data.credit_line }),
    el('p', { class: 'station-blurb', text: data.blurb }),
    data.playable
      ? null
      : el('p', { class: 'station-resting', text: 'Audio is resting. Credits and notes are still here.' }),
  ]);

  const rungs = new Map<Layer, HTMLButtonElement>();
  // The bed rung comes first in the document so Tab runs bed to stinger; CSS stacks it at the bottom.
  const rungList = LAYERS.map((layer) => {
    const button = el('button', {
      type: 'button',
      class: 'rung',
      'aria-label': `${LAYER_LABELS[layer]} layer`,
      'aria-pressed': 'false',
      'data-layer': layer,
    }, [
      el('span', { class: 'rung-fill' }),
      el('span', { class: 'rung-label', text: `${LAYER_LABELS[layer]} ${data.thresholds[layer]}` }),
    ]);
    button.addEventListener('click', () => options.onRung(layer));
    rungs.set(layer, button);
    return button;
  });

  const ladder = el(
    'div',
    { class: 'ladder', role: 'group', 'aria-label': 'Intensity ladder', 'data-active-layers': '' },
    rungList,
  );

  let slider: HTMLInputElement | null = null;
  if (options.reducedMotion) {
    slider = el('input', {
      type: 'range',
      class: 'intensity-slider',
      min: 0,
      max: 100,
      step: 1,
      value: 0,
      'aria-label': `Intensity for ${data.title}`,
    });
    slider.addEventListener('input', () => options.onSlider(Number((slider as HTMLInputElement).value)));
  }

  const region = el(
    'section',
    {
      class: 'station-stage',
      role: 'region',
      'aria-labelledby': headingId,
      'data-station': data.slug,
      'data-intensity': '0',
      'data-camera': 'wide',
    },
    [textBlock, el('div', { class: 'station-controls' }, [slider, ladder])],
  );

  const chapter = el('div', { class: 'chapter station-chapter', 'data-chapter': index }, [region]);

  return {
    data,
    chapter,
    region,
    heading,
    ladder,
    slider,
    setIntensity: (intensity) => {
      region.setAttribute('data-intensity', String(intensity));
      if (slider !== null && Number(slider.value) !== intensity) slider.value = String(intensity);
    },
    setActiveLayers: (active) => {
      ladder.setAttribute('data-active-layers', LAYERS.filter((layer) => active.includes(layer)).join(','));
      for (const layer of LAYERS) {
        const button = rungs.get(layer) as HTMLButtonElement;
        button.setAttribute('aria-pressed', active.includes(layer) ? 'true' : 'false');
        button.classList.toggle('rung-active', active.includes(layer));
      }
    },
    setCamera: (state) => region.setAttribute('data-camera', state),
  };
}
