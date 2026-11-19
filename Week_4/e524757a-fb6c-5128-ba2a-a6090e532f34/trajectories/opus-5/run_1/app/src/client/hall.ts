import * as THREE from 'three';
import { copy, likesText } from '../shared/copy.js';
import { HALL_DEPTH, HALL_START, HALL_WIDTH, HEADING_ANGLE, isHallFloor, type Heading } from '../shared/islands.js';
import { Walker, type Gait } from '../shared/movement.js';
import {
  announce,
  api,
  bootstrap,
  closePanel,
  need,
  openPanel,
  pressed,
  setPressed,
  topPanel,
} from './dom.js';
import { countTo, readFigure } from './figures.js';
import { connectLive } from './live.js';
import { Holds, startStepLoop } from './steps.js';
import { wireSoundButton } from './sound.js';

type HallFrame = {
  frame: number;
  caption: string;
  likes: number;
  liked_by_me?: boolean;
  photo: { id: string; creature_name: string; score: { total: number } };
};

type Hall = { handle: string; owner_name: string; public: boolean; frames: HallFrame[] };

const DIRECTION_KEYS: Record<string, Heading> = {
  w: 'N',
  arrowup: 'N',
  a: 'W',
  arrowleft: 'W',
  s: 'S',
  arrowdown: 'S',
  d: 'E',
  arrowright: 'E',
};

export function startHallEditor(): void {
  const list = need('hall-order');
  wireSoundButton();

  function order(): HTMLElement[] {
    return Array.from(list.querySelectorAll<HTMLElement>('.hall-item'));
  }

  function relabel(): void {
    const items = order();
    items.forEach((item, index) => {
      const name = item.dataset.creature ?? '';
      const label = `${name} photo, frame ${index + 1}`;
      item.setAttribute('aria-label', label);
      const caption = item.querySelector<HTMLElement>('.hall-frame-name');
      if (caption) caption.textContent = label;
    });
  }

  function move(item: HTMLElement, direction: -1 | 1): void {
    const items = order();
    const index = items.indexOf(item);
    const next = index + direction;
    if (next < 0 || next >= items.length) return;
    if (direction === -1) list.insertBefore(item, items[next]);
    else list.insertBefore(items[next], item);
    relabel();
    item.focus();
    announce('gallery-status', copy.photoMoved(item.dataset.creature ?? '', next + 1, items.length));
  }

  list.addEventListener('keydown', (event) => {
    const item = (event.target as HTMLElement).closest('.hall-item') as HTMLElement | null;
    if (!item || !event.altKey) return;
    if (event.key === 'ArrowUp') move(item, -1);
    else if (event.key === 'ArrowDown') move(item, 1);
    else return;
    event.preventDefault();
  });

  list.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const item = target.closest('.hall-item') as HTMLElement | null;
    if (!item) return;
    if (target.classList.contains('hall-up')) move(item, -1);
    else if (target.classList.contains('hall-down')) move(item, 1);
    else if (target.classList.contains('hall-remove')) {
      item.remove();
      relabel();
      void save(false);
    }
  });

  need('your-photos').addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('hall-hang')) return;
    const source = target.closest('.your-photo') as HTMLElement | null;
    if (!source) return;
    const item = document.createElement('li');
    item.className = 'hall-item';
    item.tabIndex = 0;
    item.dataset.photo = source.dataset.photo ?? '';
    item.dataset.creature = source.dataset.creature ?? '';
    const name = document.createElement('p');
    name.className = 'hall-frame-name';
    const field = document.createElement('input');
    field.type = 'text';
    field.className = 'hall-caption';
    field.setAttribute('aria-label', `Caption for ${item.dataset.creature} photo`);
    const likes = document.createElement('p');
    const span = document.createElement('span');
    span.className = 'figure';
    span.dataset.figure = 'likes';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = likesText(0);
    likes.append(span);
    item.append(name, likes, field);
    list.append(item);
    source.remove();
    relabel();
    void save(false);
  });

  const publicSwitch = need('public-hall');
  publicSwitch.addEventListener('click', () => {
    const next = publicSwitch.getAttribute('aria-checked') !== 'true';
    publicSwitch.setAttribute('aria-checked', next ? 'true' : 'false');
    void api('/api/me/hall', { method: 'PUT', body: { public: next } }).then((answer) => {
      announce('gallery-status', answer.ok ? (next ? copy.hallPublic : copy.hallPrivate) : (answer.body.message ?? copy.photoNetwork));
    });
  });

  need('save-hall').addEventListener('click', () => void save(true));

  async function save(announceSteps: boolean): Promise<void> {
    if (announceSteps) announce('gallery-status', copy.hallSaving);
    const frames = order().map((item) => ({
      photo: item.dataset.photo ?? '',
      caption: item.querySelector<HTMLInputElement>('.hall-caption')?.value ?? '',
    }));
    const answer = await api('/api/me/hall', { method: 'PUT', body: { frames } });
    if (!answer.ok) {
      announce('gallery-status', answer.body.message ?? copy.photoNetwork);
      return;
    }
    if (announceSteps) announce('gallery-status', copy.hallSaved);
  }

  connectLive((message) => {
    if (message.kind !== 'like') return;
    updateLikes(String(message.photo), Number(message.likes));
  });
}

function updateLikes(photoId: string, likes: number): void {
  const item = document.querySelector<HTMLElement>(`[data-photo="${photoId}"]`);
  if (!item) return;
  const figure = item.querySelector<HTMLElement>('[data-figure="likes"]');
  if (!figure) return;
  countTo(figure, readFigure(figure), likes, likesText);
}

export function startHallVisit(): void {
  const data = bootstrap<{ hall: Hall; preset: string; viewer: { id: string; name: string } | null }>();
  const element = need('gallery-hall');
  const canvas = need<HTMLCanvasElement>('hall-scene');
  const holds = new Holds();
  const walker = new Walker(isHallFloor, { ...HALL_START }, 'N');
  let runToggle = false;
  wireSoundButton();

  const renderer = makeHallScene(canvas, data.hall);

  function sync(): void {
    element.dataset.step = String(walker.step);
    element.dataset.tile = `${walker.tile.x},${walker.tile.y}`;
    element.dataset.heading = walker.heading;
    element.dataset.gait = walker.gait as Gait;
    element.dataset.preset = data.preset;
    element.dataset.state = renderer ? 'ready' : 'still';
  }

  element.addEventListener('keydown', (event) => {
    if (document.activeElement !== element) return;
    const key = event.key.toLowerCase();
    if (key === 'shift') {
      holds.down('shift');
      return;
    }
    if (key in DIRECTION_KEYS) holds.down(key);
    else if (key === 'r') runToggle = !runToggle;
    else if (key === ' ') walker.requestJump();
    else return;
    event.preventDefault();
  });

  window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (key === 'shift') holds.up('shift');
    else if (key in DIRECTION_KEYS) holds.up(key);
  });

  startStepLoop(
    (moment) => {
      const key = holds.latestHeld(Object.keys(DIRECTION_KEYS), moment);
      walker.advance({ direction: key ? DIRECTION_KEYS[key] : null, running: runToggle || holds.heldAt('shift', moment) });
      holds.prune(moment - 2000);
      sync();
    },
    (now) => renderer?.(walker.tile, walker.heading, now),
  );

  const viewer = need('photo-viewer');
  const image = need<HTMLImageElement>('photo-viewer-image');

  need('hung-photos').addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const item = target.closest('.hung-photo') as HTMLElement | null;
    if (!item) return;
    if (target.classList.contains('view-photo')) {
      image.src = `/api/photos/${item.dataset.photo}/image`;
      image.alt = `${item.dataset.creature} photo`;
      viewer.dataset.zoom = '1';
      openPanel(viewer, target, need('photo-viewer-close'));
      return;
    }
    if (target.classList.contains('like-photo')) void toggleLike(item, target);
  });

  need('photo-viewer-close').addEventListener('click', () => closePanel(viewer));

  document.addEventListener('keydown', (event) => {
    if (topPanel() !== viewer) {
      if (event.key === 'Escape' && topPanel()) {
        closePanel(topPanel()!);
        event.preventDefault();
      }
      return;
    }
    const zoom = Number(viewer.dataset.zoom ?? '1');
    if (event.key === '+' || event.key === '=') viewer.dataset.zoom = String(Math.min(4, zoom + 1));
    else if (event.key === '-' || event.key === '_') viewer.dataset.zoom = String(Math.max(1, zoom - 1));
    else if (event.key === 'Escape') closePanel(viewer);
    else return;
    image.style.transform = `scale(${viewer.dataset.zoom})`;
    event.preventDefault();
  });

  async function toggleLike(item: HTMLElement, button: HTMLElement): Promise<void> {
    if (!data.viewer) {
      location.assign(`/signin?next=${encodeURIComponent(location.pathname)}`);
      return;
    }
    const liked = !pressed(button);
    const answer = await api<{ likes: number; liked: boolean }>(`/api/photos/${item.dataset.photo}/like`, {
      method: liked ? 'PUT' : 'DELETE',
      body: {},
    });
    if (!answer.ok) {
      announce('gallery-status', answer.body.message ?? copy.photoNetwork);
      return;
    }
    setPressed(button, answer.body.liked);
    updateLikes(String(item.dataset.photo), answer.body.likes);
    announce(
      'gallery-status',
      answer.body.liked ? copy.liked(item.dataset.creature ?? '') : copy.unliked(item.dataset.creature ?? ''),
    );
  }

  connectLive((message) => {
    if (message.kind !== 'like') return;
    updateLikes(String(message.photo), Number(message.likes));
    const item = document.querySelector<HTMLElement>(`[data-photo="${String(message.photo)}"]`);
    if (!data.viewer || !item) return;
    if (message.visitor_id === data.viewer.id) {
      const button = item.querySelector<HTMLElement>('.like-photo');
      if (button) setPressed(button, message.liked === true);
      return;
    }
    if (message.owner_id === data.viewer.id && message.liked === true)
      announce('gallery-status', copy.likedYours(String(message.visitor_name), item.dataset.creature ?? ''));
  });

  sync();
}

type HallRenderer = (tile: { x: number; y: number }, heading: Heading, now: number) => void;

function makeHallScene(canvas: HTMLCanvasElement, hall: Hall): HallRenderer | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f4f4f2');
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdddddd, 1.2));
  const lamp = new THREE.DirectionalLight(0xffffff, 0.8);
  lamp.position.set(3, 8, 6);
  scene.add(lamp);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(HALL_WIDTH, HALL_DEPTH),
    new THREE.MeshStandardMaterial({ color: '#e7e4dc', roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(HALL_WIDTH / 2, 0, HALL_DEPTH / 2);
  scene.add(floor);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 });
  const walls = [
    { size: [HALL_WIDTH, 3, 0.2], position: [HALL_WIDTH / 2, 1.5, 0] },
    { size: [HALL_WIDTH, 3, 0.2], position: [HALL_WIDTH / 2, 1.5, HALL_DEPTH] },
    { size: [0.2, 3, HALL_DEPTH], position: [0, 1.5, HALL_DEPTH / 2] },
    { size: [0.2, 3, HALL_DEPTH], position: [HALL_WIDTH, 1.5, HALL_DEPTH / 2] },
  ];
  for (const wall of walls) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(wall.size[0], wall.size[1], wall.size[2]), wallMaterial);
    mesh.position.set(wall.position[0], wall.position[1], wall.position[2]);
    scene.add(mesh);
  }

  const loader = new THREE.TextureLoader();
  hall.frames.forEach((frame, index) => {
    const onLeft = index % 2 === 0;
    const texture = loader.load(`/api/photos/${frame.photo.id}/image`);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 0.9),
      new THREE.MeshBasicMaterial({ map: texture }),
    );
    const depth = HALL_DEPTH - 1.5 - Math.floor(index / 2) * 2.4;
    plane.position.set(onLeft ? 0.2 : HALL_WIDTH - 0.2, 1.5, depth);
    plane.rotation.y = onLeft ? Math.PI / 2 : -Math.PI / 2;
    scene.add(plane);
  });

  let lastPose = '';
  return (tile, heading) => {
    const width = canvas.clientWidth || 480;
    const height = canvas.clientHeight || 320;
    const pose = `${tile.x},${tile.y},${heading},${width},${height}`;
    if (pose === lastPose) return;
    lastPose = pose;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    const radians = THREE.MathUtils.degToRad(HEADING_ANGLE[heading]);
    camera.position.set(tile.x + 0.5, 1.5, tile.y + 0.5);
    camera.lookAt(tile.x + 0.5 + Math.sin(radians) * 4, 1.4, tile.y + 0.5 - Math.cos(radians) * 4);
    renderer.render(scene, camera);
  };
}
