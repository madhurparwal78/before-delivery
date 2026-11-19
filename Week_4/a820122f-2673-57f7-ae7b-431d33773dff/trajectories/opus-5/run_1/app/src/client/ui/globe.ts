import type { StripFix } from '../api.js';
import { el, prefersReducedMotion, twoDecimals } from '../dom.js';

const INK = '#16283c';
const LAND = '#d8c49a';
const SEA = '#f6efdd';
const MARK = '#16283c';
const CENTRE_LATITUDE = 25;
const TURN_MS = 330;

/** Coarse chart outlines of the north-east Atlantic, drawn as buff land. */
const LAND_SHAPES: [number, number][][] = [
  [
    [-10.5, 51.4],
    [-6.0, 54.6],
    [-5.4, 55.3],
    [-7.3, 55.4],
    [-9.9, 54.3],
    [-10.1, 52.1],
  ],
  [
    [-5.7, 50.0],
    [-3.0, 51.4],
    [1.7, 52.8],
    [-1.6, 55.6],
    [-3.1, 58.6],
    [-5.2, 57.9],
    [-5.8, 55.3],
    [-3.6, 53.3],
    [-4.9, 51.6],
  ],
  [
    [-4.8, 48.4],
    [-1.0, 49.4],
    [2.5, 51.1],
    [7.6, 53.6],
    [5.0, 43.3],
    [-1.8, 43.4],
    [-2.2, 47.3],
  ],
  [
    [-9.5, 43.8],
    [-1.8, 43.4],
    [0.2, 38.9],
    [-6.3, 36.0],
    [-9.5, 38.7],
  ],
  [
    [-24.5, 64.3],
    [-14.0, 65.6],
    [-15.2, 66.5],
    [-22.8, 66.1],
  ],
];

export type Globe = {
  element: HTMLCanvasElement;
  setFixes: (fixes: StripFix[]) => void;
  turnTo: (longitude: number | null, latitude: number | null) => void;
  stop: () => void;
};

type Point = { x: number; y: number; visible: boolean };

export function createGlobe(): Globe {
  const element = el('canvas', {
    role: 'img',
    'aria-label': 'Voyage globe',
    class: 'globe',
    width: 320,
    height: 320,
  });
  element.dataset['globeLongitude'] = '';
  const context = element.getContext('2d');
  let fixes: StripFix[] = [];
  let currentLongitude = 0;
  let targetLongitude = 0;
  let markLatitude: number | null = null;
  let markLongitude: number | null = null;
  let animation: number | null = null;
  let started = false;

  function project(longitude: number, latitude: number, radius: number, size: number): Point {
    const lambda = ((longitude - currentLongitude) * Math.PI) / 180;
    const phi = (latitude * Math.PI) / 180;
    const phi0 = (CENTRE_LATITUDE * Math.PI) / 180;
    const cosC =
      Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lambda);
    const x = radius * Math.cos(phi) * Math.sin(lambda);
    const y =
      radius * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lambda));
    return { x: size / 2 + x, y: size / 2 - y, visible: cosC >= 0 };
  }

  function draw(): void {
    if (context === null) return;
    const size = element.width;
    const radius = size / 2 - 8;
    context.clearRect(0, 0, size, size);
    context.fillStyle = SEA;
    context.beginPath();
    context.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = INK;
    context.lineWidth = 1;
    context.stroke();

    context.save();
    context.beginPath();
    context.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    context.clip();

    context.strokeStyle = 'rgba(22, 40, 60, 0.28)';
    context.lineWidth = 0.5;
    for (let latitude = -60; latitude <= 60; latitude += 30) {
      context.beginPath();
      let started_ = false;
      for (let longitude = -180; longitude <= 180; longitude += 3) {
        const point = project(longitude, latitude, radius, size);
        if (!point.visible) {
          started_ = false;
          continue;
        }
        if (started_) context.lineTo(point.x, point.y);
        else {
          context.moveTo(point.x, point.y);
          started_ = true;
        }
      }
      context.stroke();
    }
    for (let longitude = -180; longitude < 180; longitude += 30) {
      context.beginPath();
      let started_ = false;
      for (let latitude = -90; latitude <= 90; latitude += 3) {
        const point = project(longitude, latitude, radius, size);
        if (!point.visible) {
          started_ = false;
          continue;
        }
        if (started_) context.lineTo(point.x, point.y);
        else {
          context.moveTo(point.x, point.y);
          started_ = true;
        }
      }
      context.stroke();
    }

    context.fillStyle = LAND;
    context.strokeStyle = 'rgba(22, 40, 60, 0.5)';
    for (const shape of LAND_SHAPES) {
      const points = shape.map(([longitude, latitude]) =>
        project(longitude, latitude, radius, size),
      );
      if (points.some((point) => !point.visible)) continue;
      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      context.closePath();
      context.fill();
      context.stroke();
    }

    if (fixes.length > 1) {
      context.strokeStyle = INK;
      context.lineWidth = 1.5;
      context.beginPath();
      let started_ = false;
      for (const fix of fixes) {
        const point = project(fix.longitude, fix.latitude, radius, size);
        if (!point.visible) {
          started_ = false;
          continue;
        }
        if (started_) context.lineTo(point.x, point.y);
        else {
          context.moveTo(point.x, point.y);
          started_ = true;
        }
      }
      context.stroke();
    }
    for (const fix of fixes) {
      const point = project(fix.longitude, fix.latitude, radius, size);
      if (!point.visible) continue;
      context.fillStyle = LAND;
      context.strokeStyle = INK;
      context.beginPath();
      context.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    if (markLatitude !== null && markLongitude !== null) {
      const point = project(markLongitude, markLatitude, radius, size);
      if (point.visible) {
        context.fillStyle = MARK;
        context.beginPath();
        context.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.strokeStyle = MARK;
        context.lineWidth = 1;
        context.moveTo(point.x - 9, point.y);
        context.lineTo(point.x + 9, point.y);
        context.moveTo(point.x, point.y - 9);
        context.lineTo(point.x, point.y + 9);
        context.stroke();
      }
    }
    context.restore();
    element.dataset['globeLongitude'] = twoDecimals(currentLongitude);
  }

  function shortWay(from: number, to: number): number {
    return ((to - from + 540) % 360) - 180;
  }

  function animate(): void {
    const startLongitude = currentLongitude;
    const delta = shortWay(startLongitude, targetLongitude);
    const startedAt = performance.now();
    if (animation !== null) cancelAnimationFrame(animation);
    const step = (now: number): void => {
      const fraction = Math.min(1, (now - startedAt) / TURN_MS);
      const eased = 1 - (1 - fraction) * (1 - fraction);
      currentLongitude = startLongitude + delta * eased;
      draw();
      if (fraction < 1) animation = requestAnimationFrame(step);
      else {
        currentLongitude = targetLongitude;
        draw();
        animation = null;
      }
    };
    animation = requestAnimationFrame(step);
  }

  return {
    element,
    setFixes: (next) => {
      fixes = next;
      draw();
    },
    turnTo: (longitude, latitude) => {
      markLongitude = longitude;
      markLatitude = latitude;
      if (longitude === null) {
        draw();
        return;
      }
      targetLongitude = longitude;
      if (!started || prefersReducedMotion()) {
        started = true;
        currentLongitude = longitude;
        if (animation !== null) {
          cancelAnimationFrame(animation);
          animation = null;
        }
        draw();
        return;
      }
      if (Math.abs(shortWay(currentLongitude, targetLongitude)) < 0.005) {
        draw();
        return;
      }
      animate();
    },
    stop: () => {
      if (animation !== null) cancelAnimationFrame(animation);
      animation = null;
    },
  };
}
