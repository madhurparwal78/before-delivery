import type { Locale } from '../shared/locale.js';
import { formatNumber } from '../shared/locale.js';
import { renderedPreviewAlt, s } from '../shared/strings.js';
import type { Camera, Hotspot } from '../shared/viewer.js';
import {
  TILT_MAX,
  TILT_MIN,
  attrNum,
  cameraDistanceMm,
  projectHotspot,
  ringIndexPoint,
  ringRadius,
  ringTickDegrees,
} from '../shared/viewer.js';
import { esc, join, tag, voidTag } from './html.js';

/** The nominal canvas the first paint is measured in; the browser re-measures. */
export const NOMINAL_WIDTH = 960;
export const NOMINAL_HEIGHT = 720;

const DEG = Math.PI / 180;

function tickMarks(width: number, height: number): string {
  const cx = width / 2;
  const cy = height / 2;
  const r = ringRadius(width, height);
  return ringTickDegrees()
    .map((degrees, index) => {
      const major = index % 6 === 0;
      const length = major ? 12 : 6;
      const a = degrees * DEG;
      const sin = Math.sin(a);
      const cos = Math.cos(a);
      const line = voidTag('line', {
        class: major ? 'ring-tick ring-tick-major' : 'ring-tick',
        'data-azimuth-tick': degrees,
        x1: (cx + r * sin).toFixed(1),
        y1: (cy - r * cos).toFixed(1),
        x2: (cx + (r - length) * sin).toFixed(1),
        y2: (cy - (r - length) * cos).toFixed(1),
      });
      if (!major) return line;
      const label = tag(
        'text',
        {
          class: 'tick-label',
          'text-anchor': 'middle',
          'dominant-baseline': 'middle',
          x: (cx + (r - 24) * sin).toFixed(1),
          y: (cy - (r - 24) * cos).toFixed(1),
        },
        `${degrees}°`,
      );
      return line + label;
    })
    .join('');
}

/** The tilt arc runs along the ring's right edge from −10 to +80 degrees. */
export function tiltMarkerPoint(
  tilt: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const r = ringRadius(width, height);
  const fraction = (tilt - TILT_MIN) / (TILT_MAX - TILT_MIN);
  return {
    x: width / 2 + r + 10 + 6 * Math.sin(Math.PI * fraction),
    y: height / 2 + r * 0.62 - fraction * r * 1.24,
  };
}

function tiltArc(width: number, height: number): string {
  const bottom = tiltMarkerPoint(TILT_MIN, width, height);
  const top = tiltMarkerPoint(TILT_MAX, width, height);
  const r = ringRadius(width, height);
  const bulge = width / 2 + r + 22;
  return voidTag('path', {
    class: 'tilt-arc',
    d: `M ${bottom.x.toFixed(1)} ${bottom.y.toFixed(1)} Q ${bulge.toFixed(1)} ${(height / 2).toFixed(1)} ${top.x.toFixed(1)} ${top.y.toFixed(1)}`,
  });
}

export interface RingState {
  readonly camera: Camera;
  readonly boundingRadiusMm: number;
  readonly hotspots: readonly Hotspot[];
  readonly activeHotspot: number | null;
}

function ringSvg(state: RingState, locale: Locale, width: number, height: number): string {
  const { camera } = state;
  const index = ringIndexPoint(camera.azimuth, width, height);
  const tilt = tiltMarkerPoint(camera.tilt, width, height);
  const r = ringRadius(width, height);

  const dots = state.hotspots
    .map((hotspot, i) => {
      const point = projectHotspot(
        { x: hotspot.x_mm, y: hotspot.y_mm, z: hotspot.z_mm },
        camera,
        state.boundingRadiusMm,
        width,
        height,
      );
      return voidTag('circle', {
        class: 'hotspot-dot',
        'data-part': 'hotspot-dot',
        'data-index': i + 1,
        'data-active': state.activeHotspot === i + 1 ? 'true' : 'false',
        cx: point.x,
        cy: point.y,

        r: 5,
      });
    })
    .join('');

  let caliper = '';
  const active = state.activeHotspot;
  if (active !== null) {
    const hotspot = state.hotspots[active - 1];
    if (hotspot !== undefined) {
      const point = projectHotspot(
        { x: hotspot.x_mm, y: hotspot.y_mm, z: hotspot.z_mm },
        camera,
        state.boundingRadiusMm,
        width,
        height,
      );
      caliper = voidTag('line', {
        class: 'caliper-line',
        'data-part': 'caliper',
        'data-x1': index.x,
        'data-y1': index.y,
        'data-x2': point.x,
        'data-y2': point.y,
        x1: index.x,
        y1: index.y,
        x2: point.x,
        y2: point.y,
      });
    }
  }

  return tag(
    'svg',
    {
      class: 'survey-ring',
      role: 'img',
      'aria-label': s('surveyRing', locale),
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: 'none',
      'data-ring': 'true',
    },
    voidTag('circle', {
      class: 'ring-circle',
      cx: width / 2,
      cy: height / 2,
      r: r.toFixed(1),
    }),
    tickMarks(width, height),
    tiltArc(width, height),
    voidTag('line', {
      class: 'tilt-marker',
      'data-part': 'tilt-marker',
      'data-angle': attrNum(camera.tilt),
      x1: (tilt.x - 7).toFixed(1),
      y1: tilt.y.toFixed(1),
      x2: (tilt.x + 7).toFixed(1),
      y2: tilt.y.toFixed(1),
    }),
    voidTag('line', {
      class: 'index-mark',
      'data-part': 'index-mark',
      'data-angle': attrNum(camera.azimuth),
      x1: (width / 2 + (r - 16) * Math.sin(camera.azimuth * DEG)).toFixed(1),
      y1: (height / 2 - (r - 16) * Math.cos(camera.azimuth * DEG)).toFixed(1),
      x2: index.x,
      y2: index.y,
    }),
    dots,
    caliper,
  );
}

function readout(camera: Camera, boundingRadiusMm: number, locale: Locale): string {
  const distance = cameraDistanceMm(camera.distance, boundingRadiusMm);
  const lines: readonly [string, string][] = [
    [s('readoutDistance', locale), `${formatNumber(Math.round(distance * 10) / 10, locale)} mm`],
    [s('readoutFov', locale), `${formatNumber(camera.fov, locale)}°`],
    [s('readoutTilt', locale), `${formatNumber(camera.tilt, locale)}°`],
    [s('readoutAzimuth', locale), `${formatNumber(camera.azimuth, locale)}°`],
  ];
  return tag(
    'div',
    { class: 'camera-readout', role: 'group', 'aria-label': s('cameraReadout', locale) },
    ...lines.map(([label, value], i) =>
      tag(
        'p',
        { class: 'readout-line', 'data-readout': ['distance', 'fov', 'tilt', 'azimuth'][i] },
        `${esc(label)} ${esc(value)}`,
      ),
    ),
  );
}

export interface ViewerOptions {
  readonly locale: Locale;
  readonly title: string;
  readonly slug: string;
  readonly camera: Camera;
  readonly boundingRadiusMm: number;
  readonly scaleDenominator: number;
  readonly hotspots: readonly Hotspot[];
  readonly dimensionsMm: { readonly width: number; readonly height: number; readonly depth: number };
  readonly previewUrl: string;
  readonly glbUrl: string;
  readonly rebuilding: boolean;
  /** Studio viewers also place hotspots and save the default view. */
  readonly studio?: boolean;
}

export function viewerMarkup(options: ViewerOptions): string {
  const { locale, camera } = options;
  const state: RingState = {
    camera,
    boundingRadiusMm: options.boundingRadiusMm,
    hotspots: options.hotspots,
    activeHotspot: null,
  };

  const frame = tag(
    'div',
    {
      class: 'viewer-frame',
      role: 'group',
      'aria-label': s('modelViewer', locale),
      tabindex: '0',
      'data-viewer-root': 'true',
      'data-mode': 'orbit',
      'data-render': 'preview',
      'data-animating': 'false',
      'data-camera-distance': attrNum(cameraDistanceMm(camera.distance, options.boundingRadiusMm)),
      'data-fov': attrNum(camera.fov),
      'data-tilt': attrNum(camera.tilt),
      'data-azimuth': attrNum(camera.azimuth),
      'data-distance-factor': attrNum(camera.distance),
      'data-bounding-radius': attrNum(options.boundingRadiusMm),
      'data-scale-denominator': options.scaleDenominator,
      'data-model-height': attrNum(options.dimensionsMm.height),
      'data-glb-url': options.glbUrl,
      'data-studio': options.studio === true ? 'true' : 'false',
    },
    voidTag('img', {
      class: 'viewer-preview',
      src: options.previewUrl,
      alt: renderedPreviewAlt(options.title, locale),
    }),
    ringSvg(state, locale, NOMINAL_WIDTH, NOMINAL_HEIGHT),
  );

  const controls = tag(
    'div',
    { class: 'viewer-controls' },
    tag('button', { type: 'button', class: 'button button-secondary', 'data-viewer-action': 'previous-hotspot' }, esc(s('previousHotspot', locale))),
    tag('button', { type: 'button', class: 'button button-secondary', 'data-viewer-action': 'next-hotspot' }, esc(s('nextHotspot', locale))),
    tag('button', { type: 'button', class: 'button button-secondary', 'aria-pressed': 'false', 'data-viewer-action': 'first-person' }, esc(s('firstPerson', locale))),
    tag('button', { type: 'button', class: 'button button-secondary', 'data-viewer-action': 'reset' }, esc(s('resetView', locale))),
  );

  return join(
    frame,
    tag('p', { class: 'viewer-fallback-note' }, esc(s('viewerFallback', locale))),
    options.rebuilding ? tag('p', { class: 'notice' }, esc(s('previewRebuilding', locale))) : '',
    readout(camera, options.boundingRadiusMm, locale),
    controls,
    tag('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': s('viewerAnnouncements', locale),
      'data-viewer-status': 'true',
    }),
  );
}
